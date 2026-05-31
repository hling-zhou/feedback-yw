import { normalizeQuoteExtractionConfig } from './quoteExtraction.js'
import { normalizeQuoteNoiseConfig } from './quoteNoise.js'

/** @typedef {import('./storage.js').AppSettings} AppSettings */
/** @typedef {import('../storage/adapter.js').StorageAdapter} StorageAdapter */

export const META_KEY_APP_SETTINGS_SHARED = 'app_settings_shared_v1'

/** 写入共享库的团队分析设置（不含 LLM 与个人密钥） */
const TEAM_SHARED_KEYS = [
  'useRegex',
  'quoteExtraction',
  'quoteNoise',
  'useRequestNodeForJourney',
  'themeMatchMode',
  'ticketLlmMode',
  'journeyLlmGating',
  'journeyLlmSkipScoreThreshold',
  'taggingPipelineOrder',
  'retagDimensionsAfterTicketLlm',
  'optimizationMode',
  'overviewConclusionsLlm',
  'overviewPolishIncludeRecommendations',
]

/** 仅本机 localStorage 的大模型连接参数 */
const PERSONAL_LLM_KEYS = ['llmBaseUrl', 'llmModel', 'llmApiKey']

/**
 * @param {AppSettings} settings
 */
export function pickTeamAppSettings(settings) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of TEAM_SHARED_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key]
  }
  return out
}

/**
 * @param {AppSettings} settings
 */
export function pickPersonalLlmSettings(settings) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of PERSONAL_LLM_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key]
  }
  return out
}

/** @deprecated 使用 pickTeamAppSettings */
export function pickSharedAppSettings(settings) {
  return pickTeamAppSettings(settings)
}

/**
 * @param {StorageAdapter} adapter
 * @returns {Promise<Partial<AppSettings>>}
 */
export async function loadTeamAppSettings(adapter) {
  const raw = await adapter.getMeta(META_KEY_APP_SETTINGS_SHARED)
  if (!raw || typeof raw !== 'object') return {}
  const team = /** @type {Record<string, unknown>} */ ({ ...raw })
  delete team.llmBaseUrl
  delete team.llmModel
  const partial = /** @type {Partial<AppSettings>} */ (team)
  if (partial.quoteExtraction) {
    partial.quoteExtraction = normalizeQuoteExtractionConfig(partial.quoteExtraction)
  }
  if (partial.quoteNoise) {
    partial.quoteNoise = normalizeQuoteNoiseConfig(partial.quoteNoise)
  }
  return partial
}

/** @deprecated 使用 loadTeamAppSettings */
export const loadSharedAppSettings = loadTeamAppSettings

/**
 * @param {StorageAdapter} adapter
 * @param {AppSettings} settings
 */
export async function saveTeamAppSettings(adapter, settings) {
  const existing = await loadTeamAppSettings(adapter)
  await adapter.putMeta(META_KEY_APP_SETTINGS_SHARED, {
    ...existing,
    ...pickTeamAppSettings(settings),
    updatedAt: new Date().toISOString(),
  })
}

/** @deprecated 使用 saveTeamAppSettings */
export const saveSharedAppSettings = saveTeamAppSettings

/**
 * 登录时合并团队设置与本机 LLM；兼容旧版共享库中的 llmBaseUrl/llmModel。
 * @param {Partial<AppSettings>} team
 * @param {AppSettings} local
 */
export function mergeTeamAndLocalSettings(team, local) {
  const legacy = /** @type {Partial<AppSettings>} */ (team)
  const teamPicked = pickTeamAppSettings(/** @type {AppSettings} */ ({ ...local, ...team }))
  return {
    ...local,
    ...teamPicked,
    quoteExtraction: normalizeQuoteExtractionConfig(
      teamPicked.quoteExtraction ?? local.quoteExtraction,
    ),
    quoteNoise: normalizeQuoteNoiseConfig(teamPicked.quoteNoise ?? local.quoteNoise),
    llmApiKey: local.llmApiKey,
    llmBaseUrl: local.llmBaseUrl || legacy.llmBaseUrl || local.llmBaseUrl,
    llmModel: local.llmModel || legacy.llmModel || local.llmModel,
  }
}
