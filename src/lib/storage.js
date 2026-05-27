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

/** @typedef {import('./quoteExtraction.js').QuoteExtractionConfig} QuoteExtractionConfig */

/** @typedef {import('./quoteNoise.js').QuoteNoiseConfig} QuoteNoiseConfig */

/** @typedef {{ useRegex: boolean; useRequestNodeForJourney: boolean; quoteExtraction?: QuoteExtractionConfig; quoteNoise?: QuoteNoiseConfig; themeRules?: ThemeRule[]; themeMatchMode: ThemeMatchMode; optimizationMode: OptimizationMode; overviewConclusionsLlm: boolean; overviewPolishIncludeRecommendations: boolean; llmBaseUrl: string; llmModel: string; llmApiKey?: string; llmServerConfigured?: boolean }} AppSettings */

/** @type {ThemeMatchMode} */
export const DEFAULT_THEME_MATCH_MODE = 'hybrid'

const DEFAULT_SETTINGS = {
  useRegex: true,
  quoteExtraction: defaultQuoteExtractionConfig(),
  quoteNoise: normalizeQuoteNoiseConfig(),
  /** 工单「请求节点」字段误差大，默认不用于旅程打标 */
  useRequestNodeForJourney: false,
  themeMatchMode: DEFAULT_THEME_MATCH_MODE,
  optimizationMode: 'llm',
  /** 生成/刷新洞察快照时，对周期洞察概览做 LLM 润色（需 API Key） */
  overviewConclusionsLlm: false,
  /** 周期洞察 LLM 润色时是否一并润色行动建议 */
  overviewPolishIncludeRecommendations: true,
  llmBaseUrl: 'https://api.openai.com/v1',
  llmModel: 'gpt-4o-mini',
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
      optimizationMode: parsed.optimizationMode || DEFAULT_SETTINGS.optimizationMode,
      overviewConclusionsLlm:
        parsed.overviewConclusionsLlm ?? DEFAULT_SETTINGS.overviewConclusionsLlm,
      overviewPolishIncludeRecommendations:
        parsed.overviewPolishIncludeRecommendations ??
        DEFAULT_SETTINGS.overviewPolishIncludeRecommendations,
      llmBaseUrl: parsed.llmBaseUrl || DEFAULT_SETTINGS.llmBaseUrl,
      llmModel: parsed.llmModel || DEFAULT_SETTINGS.llmModel,
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
