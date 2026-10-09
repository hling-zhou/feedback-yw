/**
 * 所有 LLM 请求经 API 服务端代理（POST /api/llm/chat），密钥仅存于服务端环境变量。
 *
 * 服务端进程内调用时通过 setLlmTransport / setLlmSettingsOverride 注入直连函数，
 * 避免 in-process 时 apiFetch（依赖浏览器 sessionStorage / fetch）触发 ReferenceError。
 * @typedef {import('./storage.js').AppSettings} AppSettings
 */

import { apiFetch } from './apiClient.js'

const DEFAULT_BASE = 'https://api.openai.com/v1'

/** @type {boolean | null} */
let serverConfiguredCache = null

/**
 * 可插拔 transport —— 服务端注入后直接调用 forwardLlmChatCompletion，绕过 apiFetch。
 * @typedef {(body: object) => Promise<unknown>} LlmTransportFn
 */
/** @type {LlmTransportFn | null} */
let llmTransport = null

/**
 * 可插拔 settings 覆盖 —— 服务端注入后跳过 refreshLlmServerStatus（apiFetch 调 /api/llm/status）。
 * @type {(Partial<AppSettings> & { llmServerConfigured?: boolean }) | null}
 */
let llmSettingsOverride = null

/**
 * 服务端调用：注入直连 transport + settings 覆盖。
 * 传 null 重置回浏览器模式。
 * @param {LlmTransportFn | null} transport
 * @param {(Partial<AppSettings> & { llmServerConfigured?: boolean }) | null} [settingsOverride]
 */
export function setLlmTransport(transport, settingsOverride = null) {
  llmTransport = transport
  llmSettingsOverride = settingsOverride
}

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
  // 服务端直连模式：跳过 apiFetch（/api/llm/status），直接用注入的覆盖值
  if (llmSettingsOverride) {
    serverConfiguredCache = Boolean(llmSettingsOverride.llmServerConfigured)
    return serverConfiguredCache
  }
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
 * @param {AppSettings | { llmServerConfigured?: boolean }} [settings]
 */
export function isLlmAvailable(settings) {
  if (serverConfiguredCache === true) return true
  if (settings?.llmServerConfigured === true) return true
  return false
}

/**
 * 打标前合并本机设置与服务端 LLM 状态（避免首次 /status 失败导致 llmServerConfigured 一直为 false）。
 * 服务端直连模式下用注入的覆盖值，不调 apiFetch。
 * @param {AppSettings} [settings]
 * @returns {Promise<AppSettings>}
 */
export async function resolveSettingsForLlm(settings = {}) {
  const serverConfigured = await refreshLlmServerStatus()
  return {
    ...settings,
    ...(llmSettingsOverride || {}),
    llmServerConfigured: serverConfigured,
  }
}

/**
 * 兼容 OpenAI 与部分网关（如 GLM/zhanlu）的 message 字段。
 * 思考模型可能将正文放在 reasoning_content，content 为空。
 *
 * @param {unknown} message
 */
/**
 * @param {unknown} content
 * @returns {string}
 */
function contentToText(content) {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        const row = /** @type {Record<string, unknown>} */ (part)
        if (typeof row.text === 'string') return row.text
        if (typeof row.content === 'string') return row.content
        if (row.tool || row.answer) return JSON.stringify(row)
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  if (content && typeof content === 'object') {
    const row = /** @type {Record<string, unknown>} */ (content)
    if (typeof row.text === 'string' && row.text.trim()) return row.text.trim()
    if (row.tool || row.answer) return JSON.stringify(row)
  }
  return ''
}

export function extractLlmAssistantText(message) {
  if (!message || typeof message !== 'object') return ''
  const content = contentToText(/** @type {{ content?: unknown }} */ (message).content)
  if (content) return content
  const reasoning = contentToText(
    /** @type {{ reasoning_content?: unknown }} */ (message).reasoning_content,
  )
  if (reasoning) return reasoning
  return ''
}

/**
 * @param {unknown} data chat completion 响应
 * @returns {string}
 */
export function getLlmCompletionText(data) {
  const root = data?.data?.choices ? data.data : data
  const choice = root?.choices?.[0]
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
 * 网关或模型常把工具 JSON 包在思考标签、弯引号、BOM 里，严格 JSON.parse 会失败。
 * @param {string} text
 * @returns {string[]}
 */
function looseJsonCandidates(text) {
  const cleaned = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .replace(/[\u201C\u201D\uFF02]/g, '"')
    .replace(/[\u2018\u2019\uFF07]/g, "'")
    .replace(/[\uFF5B｛]/g, '{')
    .replace(/[\uFF5D｝]/g, '}')
    .replace(/\uFF3B/g, '[')
    .replace(/\uFF3D/g, ']')
    .replace(/\uFF1A/g, ':')
    .replace(/\uFF0C/g, ',')
    .replace(/[\u00A0\u3000]/g, ' ')
    .trim()
  const noThink = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fenced = stripMarkdownJsonFence(noThink)
  /** @type {string[]} */
  const list = [cleaned, noThink, fenced]
  const balanced = extractBalancedJsonSlice(fenced)
  if (balanced) list.push(balanced)
  for (const item of [...list]) {
    const withoutTrailingComma = item.replace(/,\s*([}\]])/g, '$1')
    if (withoutTrailingComma !== item) list.push(withoutTrailingComma)
  }
  return [...new Set(list.filter(Boolean))]
}

/**
 * 正文里能认出工具名时，即使外层标点不规范也按工具调用处理。
 * @param {string} text
 * @returns {{ tool: string, args: Record<string, unknown> } | null}
 */
function extractToolCallFallback(text) {
  const toolMatch = String(text || '').match(/["“＂]tool["”＂]\s*[:：\uFF1A]\s*["“＂]([A-Za-z0-9_]+)["”＂]/)
  if (!toolMatch) return null
  const argsMatch = String(text).match(/["“]args["”]\s*[:：]\s*(\{[\s\S]*?\})/)
  /** @type {Record<string, unknown>} */
  let args = {}
  if (argsMatch) {
    try {
      const parsed = JSON.parse(argsMatch[1].replace(/,\s*([}\]])/g, '$1'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed
    } catch {
      args = {}
    }
  }
  return { tool: toolMatch[1], args }
}

/**
 * 模型会把半截 JSON 和完整 JSON 粘在一起。从每个括号起再切一次，后面的完整对象才能被看见。
 * @param {string} text
 * @returns {string[]}
 */
function collectBalancedJsonSlices(text) {
  /** @type {string[]} */
  const slices = []
  const source = String(text || '')
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (ch !== '{' && ch !== '[') continue
    const slice = extractBalancedJsonSlice(source.slice(i))
    if (slice) slices.push(slice)
  }
  return slices
}

/**
 * 多个对象时保留最后一条完整答案或工具调用。前面的半截对象丢掉。
 * @param {unknown[]} values
 */
function pickAssistantPayload(values) {
  const objects = values.filter((value) => value && typeof value === 'object' && !Array.isArray(value))
  const answers = objects.filter((value) => {
    const row = /** @type {Record<string, unknown>} */ (value)
    return typeof row.answer === 'string' && row.answer.trim()
  })
  if (answers.length) return answers[answers.length - 1]
  // 一批工具：{"tools":[...]}
  const batches = objects.filter((value) => {
    const row = /** @type {Record<string, unknown>} */ (value)
    return Array.isArray(row.tools) && row.tools.length
  })
  if (batches.length) return batches[batches.length - 1]
  const tools = objects.filter((value) => typeof /** @type {Record<string, unknown>} */ (value).tool === 'string')
  if (tools.length) return tools[tools.length - 1]
  return objects.length ? objects[objects.length - 1] : null
}

/**
 * @param {string} text
 * @returns {{ answer: string, citations: [], links: [] } | null}
 */
function extractAnswerFallback(text) {
  const re = /["“＂]answer["”＂]\s*[:：\uFF1A]\s*"((?:\\.|[^"\\])*)"/g
  let match = re.exec(text)
  /** @type {string | null} */
  let best = null
  while (match) {
    const value = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    if (!best || value.length > best.length) best = value
    match = re.exec(text)
  }
  if (!best || !best.trim()) return null
  return { answer: best, citations: [], links: [] }
}

function parseJsonCandidate(candidate) {
  let value = JSON.parse(candidate)
  if (typeof value === 'string') {
    const inner = value.trim()
    if (inner.startsWith('{') || inner.startsWith('[')) {
      try {
        value = JSON.parse(inner)
      } catch {
        /* 保持字符串 */
      }
    }
  }
  return value
}

/**
 * @param {string} text
 */
export function parseLlmResponseBody(text) {
  const trimmed = text.trimStart()
  if (/^<!doctype|^<html[\s>]/i.test(trimmed)) {
    throw new Error(
      '接口返回了 HTML 页面而非 JSON。请检查服务端 LLM_BASE_URL 是否为 OpenAI 兼容 API 基址（以 /v1 结尾）。',
    )
  }

  const candidates = looseJsonCandidates(text)
  for (const slice of collectBalancedJsonSlices(text)) candidates.push(slice)

  /** @type {unknown[]} */
  const parsed = []
  let lastErr = null
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      parsed.push(parseJsonCandidate(candidate))
    } catch (err) {
      lastErr = err
    }
  }

  const best = pickAssistantPayload(parsed)
  if (best) return best

  const answerFallback = extractAnswerFallback(text)
  if (answerFallback) return answerFallback

  const toolFallback = extractToolCallFallback(text)
  if (toolFallback) return toolFallback

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
 * 请求 model：设置页填写 > 不传（服务端 LLM_MODEL）。不在前端兜底 gpt-4o-mini。
 * @param {AppSettings | { llmModel?: string; llmServerConfigured?: boolean }} [settings]
 * @returns {string | undefined}
 */
export function resolvePayloadModel(settings) {
  const fromSettings = settings?.llmModel?.trim()
  if (fromSettings) return fromSettings
  return undefined
}

/**
 * @param {AppSettings} settings
 * @param {object} body OpenAI chat completion body（model 可省略，使用设置或服务端 LLM_MODEL）
 */
export async function llmChatCompletion(settings, body) {
  const payload = { ...body }
  delete payload.model
  const baseUrl = settings?.llmBaseUrl?.trim()
  if (baseUrl) {
    payload.baseUrl = normalizeLlmBaseUrl(baseUrl)
  }
  const model = resolvePayloadModel(settings)
  if (model) {
    payload.model = model
  }

  // 服务端直连模式：直接调 forwardLlmChatCompletion，不走 apiFetch
  if (llmTransport) {
    return /** @type {any} */ (await llmTransport(payload))
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
        '无法连接 LLM 代理。请确认 API 已启动（npm run dev:all）且已登录；大模型配置由管理员在「设置」中维护。',
      )
    }
    throw err
  }
}
