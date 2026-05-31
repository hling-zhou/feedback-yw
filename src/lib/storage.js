import { defaultQuoteExtractionConfig, normalizeQuoteExtractionConfig } from './quoteExtraction.js'
import { normalizeQuoteNoiseConfig } from './quoteNoise.js'

const STORAGE_KEY = 'feedback-insights-records'
const SETTINGS_KEY = 'feedback-insights-settings'

function hasLocalStorage() {
  return typeof localStorage !== 'undefined'
}

/** @typedef {import('./themes.js').ThemeRule} ThemeRule */

/**
 * @typedef {'keyword' | 'description' | 'semantic' | 'hybrid'} ThemeMatchMode
 * keyword=仅关键词 | description=解释+关键词(本地) | semantic=LLM语义 | hybrid=本地+LLM合并(需API Key)
 */

/**
 * @typedef {'rules' | 'llm'} OptimizationMode
 * rules=本地规则+playbook | llm=大模型生成具体举措(需API Key)
 */

/**
 * @typedef {'unified' | 'split2' | 'separate'} TicketLlmMode
 * unified=客户请求/痛点/优化合并 1 次 LLM | separate=三次独立调用（回滚）| split2=待实现
 */

/**
 * @typedef {'ticket_first' | 'legacy'} TaggingPipelineOrder
 * ticket_first=工单 LLM 先于旅程 LLM | legacy=旅程先于工单（回滚）
 */

/** @typedef {import('./quoteExtraction.js').QuoteExtractionConfig} QuoteExtractionConfig */

/** @typedef {import('./quoteNoise.js').QuoteNoiseConfig} QuoteNoiseConfig */

/** @typedef {{ useRegex: boolean; useRequestNodeForJourney: boolean; quoteExtraction?: QuoteExtractionConfig; quoteNoise?: QuoteNoiseConfig; themeRules?: ThemeRule[]; themeMatchMode: ThemeMatchMode; ticketLlmMode?: TicketLlmMode; journeyLlmGating?: boolean; journeyLlmSkipScoreThreshold?: number; taggingPipelineOrder?: TaggingPipelineOrder; retagDimensionsAfterTicketLlm?: boolean; optimizationMode: OptimizationMode; overviewConclusionsLlm: boolean; overviewPolishIncludeRecommendations: boolean; llmBaseUrl: string; llmModel: string; llmApiKey?: string; llmServerConfigured?: boolean }} AppSettings */

/** @type {ThemeMatchMode} */
export const DEFAULT_THEME_MATCH_MODE = 'hybrid'

/** @type {TicketLlmMode} */
export const DEFAULT_TICKET_LLM_MODE = 'unified'

/** hybrid 旅程门控：本地 score ≥ 此阈值且库内合法则跳过 LLM */
export const DEFAULT_JOURNEY_LLM_SKIP_SCORE_THRESHOLD = 3

/** @type {TaggingPipelineOrder} */
export const DEFAULT_TAGGING_PIPELINE_ORDER = 'ticket_first'

const DEFAULT_SETTINGS = {
  useRegex: true,
  quoteExtraction: defaultQuoteExtractionConfig(),
  quoteNoise: normalizeQuoteNoiseConfig(),
  /** 工单「请求节点」字段误差大，默认不用于旅程打标 */
  useRequestNodeForJourney: false,
  themeMatchMode: DEFAULT_THEME_MATCH_MODE,
  ticketLlmMode: DEFAULT_TICKET_LLM_MODE,
  journeyLlmGating: true,
  journeyLlmSkipScoreThreshold: DEFAULT_JOURNEY_LLM_SKIP_SCORE_THRESHOLD,
  taggingPipelineOrder: DEFAULT_TAGGING_PIPELINE_ORDER,
  /** 工单 LLM 成功后，按 LLM 客户请求/痛点重打请求场景与问题类型 */
  retagDimensionsAfterTicketLlm: true,
  optimizationMode: 'llm',
  /** 生成/刷新洞察快照时，对周期洞察概览做 LLM 润色（需 API Key） */
  overviewConclusionsLlm: false,
  /** 周期洞察 LLM 润色时是否一并润色行动建议 */
  overviewPolishIncludeRecommendations: true,
  llmBaseUrl: '',
  llmModel: '',
}

/** 旧版默认填充（加载时视为未配置，避免误连 OpenAI） */
const LEGACY_DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1'
const LEGACY_DEFAULT_LLM_MODEL = 'gpt-4o-mini'

/**
 * @param {Record<string, unknown>} parsed
 */
function resolveLlmFieldsFromParsed(parsed) {
  let llmBaseUrl = typeof parsed.llmBaseUrl === 'string' ? parsed.llmBaseUrl.trim() : ''
  let llmModel = typeof parsed.llmModel === 'string' ? parsed.llmModel.trim() : ''
  if (llmBaseUrl === LEGACY_DEFAULT_LLM_BASE_URL) llmBaseUrl = ''
  if (llmModel === LEGACY_DEFAULT_LLM_MODEL) llmModel = ''
  return { llmBaseUrl, llmModel }
}

/**
 * 剥离已废弃字段；llmApiKey 仍保存在本机 localStorage（线上配置过渡）。
 * @param {Record<string, unknown>} parsed
 */
function sanitizePersistedSettings(parsed) {
  const { llmUseDevProxy: _proxy, ...rest } = parsed
  return rest
}

/**
 * @deprecated 业务数据请使用 IndexedDB（见 storage/feedbackStore.js）
 * @returns {import('./types.js').FeedbackRecord[]}
 */
export function loadFeedbacks() {
  if (!hasLocalStorage()) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(normalizeStoredFeedback) : []
  } catch {
    return []
  }
}

function normalizeImportMonthValue(value) {
  const v = String(value || '').trim()
  if (!/^\d{4}-\d{2}$/.test(v)) return ''
  const [y, m] = v.split('-').map(Number)
  if (!y || m < 1 || m > 12) return ''
  return `${y}-${String(m).padStart(2, '0')}`
}

function monthFrom(value) {
  if (!value) return ''
  const str = String(value)
  const match = str.match(/^(\d{4})[-/](\d{1,2})/)
  if (!match) return ''
  return `${match[1]}-${match[2].padStart(2, '0')}`
}

export function normalizeStoredFeedback(record) {
  const importMonth =
    (record.importMonth && normalizeImportMonthValue(record.importMonth)) ||
    monthFrom(record.importedAt) ||
    monthFrom(record.createdAt) ||
    ''
  return {
    ...record,
    importMonth,
    importBatchId: record.importBatchId || (importMonth ? `legacy-${importMonth}` : 'legacy-unknown'),
    importBatchName: record.importBatchName || (importMonth ? `${importMonth} 历史数据` : '历史数据'),
  }
}

/**
 * @deprecated 业务数据请使用 IndexedDB（见 storage/feedbackStore.js）
 * @param {import('./types.js').FeedbackRecord[]} records
 */
export function saveFeedbacks(records) {
  if (!hasLocalStorage()) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

/** 清除 localStorage 中的历史反馈（迁移后或清空数据时调用） */
export function clearFeedbacks() {
  if (!hasLocalStorage()) return
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * @returns {AppSettings}
 */
export function loadSettings() {
  if (!hasLocalStorage()) return { ...DEFAULT_SETTINGS }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = sanitizePersistedSettings(JSON.parse(raw))
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      quoteExtraction: normalizeQuoteExtractionConfig(
        parsed.quoteExtraction ?? DEFAULT_SETTINGS.quoteExtraction,
      ),
      quoteNoise: normalizeQuoteNoiseConfig(parsed.quoteNoise ?? DEFAULT_SETTINGS.quoteNoise),
      useRequestNodeForJourney:
        parsed.useRequestNodeForJourney ?? DEFAULT_SETTINGS.useRequestNodeForJourney,
      themeMatchMode: parsed.themeMatchMode || DEFAULT_SETTINGS.themeMatchMode,
      ticketLlmMode: parsed.ticketLlmMode || DEFAULT_SETTINGS.ticketLlmMode,
      journeyLlmGating: parsed.journeyLlmGating ?? DEFAULT_SETTINGS.journeyLlmGating,
      journeyLlmSkipScoreThreshold:
        parsed.journeyLlmSkipScoreThreshold ?? DEFAULT_SETTINGS.journeyLlmSkipScoreThreshold,
      taggingPipelineOrder:
        parsed.taggingPipelineOrder || DEFAULT_SETTINGS.taggingPipelineOrder,
      retagDimensionsAfterTicketLlm:
        parsed.retagDimensionsAfterTicketLlm ?? DEFAULT_SETTINGS.retagDimensionsAfterTicketLlm,
      optimizationMode: parsed.optimizationMode || DEFAULT_SETTINGS.optimizationMode,
      overviewConclusionsLlm:
        parsed.overviewConclusionsLlm ?? DEFAULT_SETTINGS.overviewConclusionsLlm,
      overviewPolishIncludeRecommendations:
        parsed.overviewPolishIncludeRecommendations ??
        DEFAULT_SETTINGS.overviewPolishIncludeRecommendations,
      ...resolveLlmFieldsFromParsed(parsed),
      llmApiKey: typeof parsed.llmApiKey === 'string' ? parsed.llmApiKey : '',
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * @param {Partial<AppSettings>} settings
 */
export function saveSettings(settings) {
  if (!hasLocalStorage()) return
  const current = loadSettings()
  const { themeRules: _drop, llmServerConfigured: _runtime, ...merged } = {
    ...current,
    ...settings,
  }
  const persist = sanitizePersistedSettings(merged)
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(persist))
}
