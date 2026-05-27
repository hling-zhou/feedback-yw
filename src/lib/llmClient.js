/**
 * 所有 LLM 请求经 API 服务端代理（POST /api/llm/chat），密钥仅存于服务端环境变量。
 * @typedef {import('./storage.js').AppSettings} AppSettings
 */

import { apiFetch } from './apiClient.js'

const DEFAULT_BASE = 'https://api.openai.com/v1'

/** @type {boolean | null} */
let serverConfiguredCache = null

/**
 * @param {string} [url]
 */
export function normalizeLlmBaseUrl(url) {
  let u = (url || DEFAULT_BASE).trim()
  u = u.replace(/\/+$/, '')
  u = u.replace(/\/chat\/completions$/i, '')
  return u || DEFAULT_BASE
}

/** 从 API 刷新 LLM 是否已在服务端配置 */
export async function refreshLlmServerStatus() {
  try {
    const data = await apiFetch('/api/llm/status')
    serverConfiguredCache = Boolean(data?.configured)
    return serverConfiguredCache
  } catch {
    serverConfiguredCache = false
    return false
  }
}

/** @returns {boolean | null} null = 尚未查询 */
export function getLlmServerConfigured() {
  return serverConfiguredCache
}

/**
 * @param {AppSettings | { llmServerConfigured?: boolean; llmApiKey?: string }} [settings]
 */
export function isLlmAvailable(settings) {
  if (settings?.llmApiKey?.trim()) return true
  if (serverConfiguredCache === true) return true
  if (settings?.llmServerConfigured === true) return true
  return false
}

/**
 * 打标前合并本机设置与服务端 LLM 状态（避免首次 /status 失败导致 llmServerConfigured 一直为 false）
 * @param {AppSettings} [settings]
 * @returns {Promise<AppSettings>}
 */
export async function resolveSettingsForLlm(settings = {}) {
  const serverConfigured = await refreshLlmServerStatus()
  return {
    ...settings,
    llmServerConfigured: serverConfigured,
  }
}

/**
 * 兼容 OpenAI 与部分网关（如 GLM/zhanlu）的 message 字段。
 * 思考模型可能将正文放在 reasoning_content，content 为空。
 *
 * @param {unknown} message
 */
export function extractLlmAssistantText(message) {
  if (!message || typeof message !== 'object') return ''
  const content = typeof message.content === 'string' ? message.content.trim() : ''
  if (content) return content
  const reasoning =
    typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : ''
  if (reasoning) return reasoning
  return ''
}

/**
 * @param {unknown} data chat completion 响应
 * @returns {string}
 */
export function getLlmCompletionText(data) {
  const choice = data?.choices?.[0]
  const text = extractLlmAssistantText(choice?.message)
  if (text) return text
  if (typeof choice?.text === 'string' && choice.text.trim()) {
    return choice.text.trim()
  }
  const finish = choice?.finish_reason
  if (finish === 'length') {
    throw new Error('LLM 输出被截断（finish_reason=length），请增大 max_tokens 或缩短输入')
  }
  throw new Error('LLM 返回为空（message.content 与 reasoning_content 均无正文）')
}

/**
 * @param {string} raw
 */
function stripMarkdownJsonFence(raw) {
  let text = String(raw || '').trim()
  text = text.replace(/^```(?:json)?\s*/i, '')
  text = text.replace(/\s*```\s*$/i, '')
  return text.trim()
}

/**
 * 从不完整文本中提取首个平衡 JSON 对象或数组
 * @param {string} text
 */
function extractBalancedJsonSlice(text) {
  const startObj = text.indexOf('{')
  const startArr = text.indexOf('[')
  let start = -1
  let open = ''
  let close = ''
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
    start = startObj
    open = '{'
    close = '}'
  } else if (startArr >= 0) {
    start = startArr
    open = '['
    close = ']'
  }
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * @param {string} text
 */
export function parseLlmResponseBody(text) {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('<') || trimmed.toLowerCase().startsWith('<!doctype')) {
    throw new Error(
      '接口返回了 HTML 页面而非 JSON。请检查服务端 LLM_BASE_URL 是否为 OpenAI 兼容 API 基址（以 /v1 结尾）。',
    )
  }

  const candidates = [text.trim(), stripMarkdownJsonFence(text)]
  const balanced = extractBalancedJsonSlice(stripMarkdownJsonFence(text))
  if (balanced) candidates.push(balanced)

  let lastErr = null
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch (err) {
      lastErr = err
    }
  }

  throw new Error(
    `模型响应不是合法 JSON：${text.slice(0, 200)}${text.length > 200 ? '…' : ''}${
      lastErr instanceof Error && lastErr.message.includes('Unexpected end')
        ? '（可能被截断，可尝试增大 max_tokens）'
        : ''
    }`,
  )
}

/**
 * LLM message.content 可能带 ```json 代码块，或仅有开头 fence（GLM 等）
 * @param {string} content
 */
export function parseLlmMessageContent(content) {
  const raw = String(content || '').trim()
  if (!raw) throw new Error('LLM 返回为空')

  const closedFence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (closedFence) {
    return parseLlmResponseBody(closedFence[1].trim())
  }

  return parseLlmResponseBody(stripMarkdownJsonFence(raw))
}

/**
 * @param {AppSettings} settings
 * @param {object} body OpenAI chat completion body（model 可省略，使用设置或服务端默认）
 */
export async function llmChatCompletion(settings, body) {
  const payload = {
    ...body,
    baseUrl: normalizeLlmBaseUrl(settings?.llmBaseUrl),
    model: body.model || settings?.llmModel,
  }
  const clientKey = settings?.llmApiKey?.trim()
  if (clientKey && getLlmServerConfigured() !== true) {
    payload.apiKey = clientKey
  }

  try {
    return await apiFetch('/api/llm/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Failed to fetch' || msg.includes('NetworkError')) {
      throw new Error(
        '无法连接 LLM 代理。请确认 API 已启动（npm run dev:all）且已登录；LLM_API_KEY 由服务端配置。',
      )
    }
    throw err
  }
}
