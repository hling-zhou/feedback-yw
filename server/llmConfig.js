const DEFAULT_LLM_BASE = 'https://api.openai.com/v1'
const DEFAULT_LLM_MODEL = 'gpt-4o-mini'

/**
 * @param {string} [url]
 */
export function normalizeLlmBaseUrl(url) {
  let u = (url || DEFAULT_LLM_BASE).trim()
  u = u.replace(/\/+$/, '')
  u = u.replace(/\/chat\/completions$/i, '')
  return u || DEFAULT_LLM_BASE
}

export function isLlmConfigured() {
  return Boolean(process.env.LLM_API_KEY?.trim())
}

export function resolveLlmApiKey() {
  const key = process.env.LLM_API_KEY?.trim()
  if (!key) {
    throw new Error(
      '[config] 未设置 LLM_API_KEY。大模型功能需在服务端配置密钥，说明见 README.md「环境变量」。',
    )
  }
  return key
}

/**
 * 服务端环境变量优先；未配置时可使用请求体中的 apiKey（设置页「线上配置」，过渡方案）。
 * @param {unknown} body
 */
export function resolveLlmApiKeyForRequest(body) {
  if (isLlmConfigured()) {
    return { apiKey: resolveLlmApiKey(), source: 'server' }
  }
  const clientKey =
    body && typeof body === 'object' && typeof body.apiKey === 'string'
      ? body.apiKey.trim()
      : ''
  if (!clientKey) {
    const err = /** @type {Error & { code: string }} */ (new Error('LLM 未配置'))
    err.code = 'LLM_NOT_CONFIGURED'
    throw err
  }
  return { apiKey: clientKey, source: 'client' }
}

export function resolveLlmBaseUrl() {
  return normalizeLlmBaseUrl(process.env.LLM_BASE_URL || DEFAULT_LLM_BASE)
}

export function resolveLlmModel() {
  return (process.env.LLM_MODEL || DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL
}
