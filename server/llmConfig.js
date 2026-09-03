import { storageRepository } from './storageRepository.js'

const DEFAULT_LLM_BASE = 'https://api.openai.com/v1'
const DEFAULT_LLM_MODEL = 'gpt-4o-mini'

/** 团队大模型配置在 meta 表中的 key */
export const META_KEY_LLM_CONFIG = 'llm_config_v1'

/**
 * @param {string} [url]
 */
export function normalizeLlmBaseUrl(url) {
  let u = (url || DEFAULT_LLM_BASE).trim()
  u = u.replace(/\/+$/, '')
  u = u.replace(/\/chat\/completions$/i, '')
  return u || DEFAULT_LLM_BASE
}

/**
 * 读取库内 LLM 配置；DB 未初始化或读取失败时返回 null（回退环境变量）。
 * @returns {{ apiKey?: string; baseUrl?: string; model?: string; updatedAt?: string; updatedBy?: string } | null}
 */
function getLlmConfigFromDb() {
  try {
    const raw = storageRepository.getMeta(META_KEY_LLM_CONFIG)
    if (!raw || typeof raw !== 'object') return null
    const cfg = /** @type {Record<string, unknown>} */ (raw)
    return {
      apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '',
      baseUrl: typeof cfg.baseUrl === 'string' ? cfg.baseUrl.trim() : '',
      model: typeof cfg.model === 'string' ? cfg.model.trim() : '',
      updatedAt: typeof cfg.updatedAt === 'string' ? cfg.updatedAt : undefined,
      updatedBy: typeof cfg.updatedBy === 'string' ? cfg.updatedBy : undefined,
    }
  } catch {
    return null
  }
}

/** 库内是否配置了 apiKey */
function hasDbLlmApiKey() {
  return Boolean(getLlmConfigFromDb()?.apiKey)
}

export function isLlmConfigured() {
  if (hasDbLlmApiKey()) return true
  return Boolean(process.env.LLM_API_KEY?.trim())
}

/**
 * 解析 apiKey：库 ＞ 环境变量。两者皆无时抛错。
 * @returns {string}
 */
export function resolveLlmApiKey() {
  const dbKey = getLlmConfigFromDb()?.apiKey
  if (dbKey) return dbKey
  const envKey = process.env.LLM_API_KEY?.trim()
  if (envKey) return envKey
  throw new Error(
    '[config] 未设置 LLM_API_KEY。大模型功能需由管理员在「设置」中配置，或在服务端配置 LLM_API_KEY 环境变量。',
  )
}

/**
 * 解析 baseUrl：库 ＞ 环境变量 ＞ 默认。
 * @returns {string}
 */
export function resolveLlmBaseUrl() {
  const dbUrl = getLlmConfigFromDb()?.baseUrl
  if (dbUrl) return normalizeLlmBaseUrl(dbUrl)
  return normalizeLlmBaseUrl(process.env.LLM_BASE_URL || DEFAULT_LLM_BASE)
}

/**
 * 解析 model：库 ＞ 环境变量 ＞ 默认。
 * @returns {string}
 */
export function resolveLlmModel() {
  const dbModel = getLlmConfigFromDb()?.model
  if (dbModel) return dbModel
  return (process.env.LLM_MODEL || DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL
}

/**
 * @returns {{ configured: boolean; source: 'db' | 'env' | 'none'; baseUrl: string; model: string; apiKeyMasked: string }}
 */
export function getLlmConfigStatus() {
  const db = getLlmConfigFromDb()
  const dbKey = db?.apiKey || ''
  const envKey = process.env.LLM_API_KEY?.trim() || ''
  if (dbKey) {
    return {
      configured: true,
      source: 'db',
      baseUrl: normalizeLlmBaseUrl(db?.baseUrl || process.env.LLM_BASE_URL || DEFAULT_LLM_BASE),
      model: db?.model || (process.env.LLM_MODEL || DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL,
      apiKeyMasked: maskApiKey(dbKey),
    }
  }
  if (envKey) {
    return {
      configured: true,
      source: 'env',
      baseUrl: normalizeLlmBaseUrl(process.env.LLM_BASE_URL || DEFAULT_LLM_BASE),
      model: (process.env.LLM_MODEL || DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL,
      apiKeyMasked: maskApiKey(envKey),
    }
  }
  return {
    configured: false,
    source: 'none',
    baseUrl: normalizeLlmBaseUrl(DEFAULT_LLM_BASE),
    model: DEFAULT_LLM_MODEL,
    apiKeyMasked: '',
  }
}

/**
 * @param {string} key
 * @returns {string}
 */
export function maskApiKey(key) {
  const trimmed = key.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '••••'
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`
}
