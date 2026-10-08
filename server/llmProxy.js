import { normalizeLlmBaseUrl } from './llmConfig.js'
import { parseLlmResponseBody } from '../src/lib/llmClient.js'

/**
 * @param {number} status
 * @param {string} text
 */
export function formatLlmUpstreamError(status, text) {
  let detail = text.trim()
  if (detail) {
    try {
      const j = JSON.parse(detail)
      if (typeof j === 'string') detail = j
      else {
        detail =
          j.error?.message ||
          j.error?.hint ||
          j.error?.msg ||
          j.message ||
          (typeof j.error === 'string' ? j.error : '') ||
          detail
      }
    } catch {
      /* keep raw */
    }
  }
  if (!detail) {
    if (status === 401) return 'API Key 无效或未配置'
    if (status === 404) return 'API 地址错误，请检查 LLM_BASE_URL（须为 OpenAI 兼容 /v1 基址）'
    if (status === 429) return '请求过于频繁或额度不足'
    if (status === 500) {
      return '模型服务内部错误：请核对模型名称与 API 地址；部分接口不支持 json_object 参数'
    }
    return '无响应正文，请检查网络、API 地址与 Key'
  }
  return detail.slice(0, 400)
}

/**
 * 部分网关直接返回工具/答案 JSON，或包在 data.choices 里。
 * @param {unknown} value
 */
function coerceChatCompletion(value) {
  if (!value || typeof value !== 'object') return value
  const row = /** @type {Record<string, unknown>} */ (value)
  if (Array.isArray(row.choices)) return row
  const nested = row.data
  if (nested && typeof nested === 'object' && Array.isArray(/** @type {{ choices?: unknown }} */ (nested).choices)) {
    return nested
  }
  if (typeof row.tool === 'string' || typeof row.answer === 'string') {
    return {
      choices: [{ message: { role: 'assistant', content: JSON.stringify(row) } }],
    }
  }
  return row
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {object} opts.body
 * @param {number} [opts.timeoutMs] 单次上游请求超时（毫秒），不传则不限
 */
export async function forwardLlmChatCompletion({ baseUrl, apiKey, body, timeoutMs }) {
  const base = normalizeLlmBaseUrl(baseUrl)
  const targetUrl = `${base}/chat/completions`

  const post = async (payload, signal) => {
    let res
    try {
      res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal,
      })
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err
      const msg = err instanceof Error ? err.message : String(err)
      const isOpenAiTimeout =
        /ETIMEDOUT|ECONNREFUSED/.test(msg) && /openai\.com/i.test(base)
      const hint = isOpenAiTimeout
        ? 'OpenAI 在国内常无法直连，请设置 LLM_BASE_URL=https://api.siliconflow.cn/v1'
        : '请检查 LLM_BASE_URL、网络与 LLM_API_KEY'
      const error = new Error(`代理连接失败: ${msg}`)
      error.statusCode = 502
      error.hint = hint
      throw error
    }

    const text = await res.text()
    if (!res.ok) {
      const trimmed = text.trimStart()
      if (trimmed.startsWith('<')) {
        const error = new Error(
          `LLM 请求失败 (${res.status})：上游返回 HTML，请确认 API 基址为 /v1 而非控制台网页`,
        )
        error.statusCode = res.status
        throw error
      }
      const error = new Error(`LLM 请求失败 (${res.status}): ${formatLlmUpstreamError(res.status, text)}`)
      error.statusCode = res.status
      throw error
    }

    try {
      return coerceChatCompletion(JSON.parse(text))
    } catch {
      try {
        return coerceChatCompletion(parseLlmResponseBody(text))
      } catch {
        const error = new Error(`模型响应不是合法 JSON：${text.slice(0, 200)}`)
        error.statusCode = 502
        throw error
      }
    }
  }

  const payload = { max_tokens: 2048, ...body }

  /** @type {AbortController | null} */
  let controller = null
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null
  const withTimeout = async () => {
    if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      controller = new AbortController()
      timer = setTimeout(() => controller.abort(), timeoutMs)
      return post(payload, controller.signal)
    }
    return post(payload)
  }

  try {
    return await withTimeout()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (controller?.signal?.aborted || err?.name === 'AbortError') {
      const error = new Error(`LLM 请求超时（${timeoutMs}ms）`)
      error.statusCode = 504
      throw error
    }
    const status = err.statusCode || 0
    const canRetry =
      payload.response_format &&
      /\(400\)|\(500\)|\(502\)/.test(msg) &&
      status >= 400
    if (!canRetry) throw err
    const { response_format: _rf, ...withoutJsonMode } = payload
    return await post(withoutJsonMode, controller?.signal)
  } finally {
    if (timer) clearTimeout(timer)
  }
}
