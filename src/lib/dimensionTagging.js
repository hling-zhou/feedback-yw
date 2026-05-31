import { getSharedProblemTypes, getSharedRequestScenes } from './taxonomyLoader.js'
import { classifyProblemType, PROBLEM_TYPE_OTHER } from './problemTypeClassifier.js'
import {
  matchThemesByDescription,
  matchSharedDimensionHybridBatch,
  matchSharedDimensionLlmBatch,
  canUseSemanticMatch,
  usesLlmThemeMatch,
  mergeSharedDimensionLabel,
  resolveThemeOverflowOrigin,
  isInThemeLibrary,
} from './themeSemantic.js'
import { captureProblemTypeCandidateIfNeeded, captureRequestSceneCandidateIfNeeded } from './tagCandidates.js'
import { buildTaggingTextForRecord } from './taggingText.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

const TICKET_LIKE_SOURCES = /** @type {const} */ (['complaint_ticket', 'consultation_ticket'])
const UNCLASSIFIED_PROBLEM = '未分类'

/**
 * 问题类型：决策树 classifier 优先；未命中时回退旧版关键词/说明打分（matchSharedLabel）
 * @param {string} text
 * @param {{ label: string; description?: string; keywords?: string[] }[]} rules
 */
export function resolveProblemTypeFromConfig(text, rules) {
  const corpus = (text || '').trim()
  if (!corpus) return PROBLEM_TYPE_OTHER

  const classified = classifyProblemType(corpus, rules)
  if (classified !== PROBLEM_TYPE_OTHER) return classified

  const legacy = matchSharedLabel(corpus, rules)
  if (legacy && legacy !== UNCLASSIFIED_PROBLEM) return legacy

  return PROBLEM_TYPE_OTHER
}

/**
 * @param {FeedbackRecord} record
 * @param {string} text
 * @param {{ label: string; description?: string; keywords?: string[] }[]} rules
 */
function resolveLocalProblemTypeLabel(record, text, rules) {
  const ds = record.dataSourceType || 'complaint_ticket'
  if (TICKET_LIKE_SOURCES.includes(ds)) {
    return resolveProblemTypeFromConfig(text, rules)
  }
  const existing = record.problemType?.trim()
  if (existing && isInThemeLibrary(existing, rules)) return existing
  if (existing && existing !== UNCLASSIFIED_PROBLEM) {
    const fromExisting = matchSharedLabel(existing, rules)
    if (fromExisting !== UNCLASSIFIED_PROBLEM) return fromExisting
  }
  return resolveProblemTypeFromConfig(text, rules)
}

/**
 * 请求场景仅 config 关键词/说明匹配（与问题类型一致，永不调 LLM）。
 * @param {FeedbackRecord[]} records
 * @param {string[]} texts
 * @param {{ label: string; description?: string; keywords?: string[] }[]} rules
 * @param {import('./storage.js').AppSettings} [_settings]
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function matchRequestScenesForRecords(records, texts, rules, _settings, onProgress) {
  void _settings
  const themeRules = toThemeRules(rules)
  onProgress?.(texts.length, texts.length)
  return texts.map((text, i) => {
    const existing = records[i]?.requestScene?.trim()
    if (existing && existing !== UNCLASSIFIED_PROBLEM && isInThemeLibrary(existing, themeRules)) {
      return { label: existing, overflowOrigin: null }
    }
    return { label: matchSharedLabel(text, rules), overflowOrigin: null }
  })
}

/**
 * 投诉/咨询工单：问题类型仅 config 关键词匹配（不调 LLM）；其余来源保持混合打标。
 * @param {FeedbackRecord[]} records
 * @param {string[]} texts
 * @param {{ label: string; description?: string; keywords?: string[] }[]} rules
 * @param {import('./storage.js').AppSettings} settings
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function matchProblemTypesForRecords(records, texts, rules, settings, onProgress) {
  const local = records.map((r, i) => resolveLocalProblemTypeLabel(r, texts[i], rules))

  const themeRules = toThemeRules(rules)
  if (!canUseSemanticMatch(settings) || !usesLlmThemeMatch(settings?.themeMatchMode)) {
    return local.map((label) => ({ label, overflowOrigin: null }))
  }

  /** @type {{ label: string; overflowOrigin: 'llm' | 'local_overflow' | null }[]} */
  const results = local.map((label) => ({ label, overflowOrigin: null }))
  /** @type {number[]} */
  const llmIndices = []

  for (let i = 0; i < records.length; i++) {
    const ds = records[i].dataSourceType || 'complaint_ticket'
    if (TICKET_LIKE_SOURCES.includes(ds)) {
      // 投诉/咨询工单：问题类型仅来自标签库（关键词+说明），永不走 LLM，避免库外标签
      continue
    }
    const label = local[i]
    if (!isInThemeLibrary(label, themeRules) || label === UNCLASSIFIED_PROBLEM) {
      llmIndices.push(i)
    }
  }

  const BATCH = 8
  for (let b = 0; b < llmIndices.length; b += BATCH) {
    const idxBatch = llmIndices.slice(b, b + BATCH)
    const chunk = idxBatch.map((i) => texts[i])
    const localChunk = idxBatch.map((i) => local[i])
    try {
      const llmBatch = await matchSharedDimensionLlmBatch(chunk, themeRules, settings, localChunk)
      idxBatch.forEach((i, j) => {
        const llmLabel = llmBatch[j]?.[0] || UNCLASSIFIED_PROBLEM
        const label = mergeSharedDimensionLabel(local[i], llmLabel, themeRules)
        results[i] = {
          label,
          overflowOrigin: resolveThemeOverflowOrigin(label, local[i], llmLabel, themeRules),
        }
      })
    } catch (err) {
      console.warn('问题类型 LLM 打标失败，该批保留本地结果:', err)
      idxBatch.forEach((i) => {
        results[i] = { label: local[i], overflowOrigin: null }
      })
    }
    onProgress?.(Math.min(b + BATCH, llmIndices.length), llmIndices.length)
  }

  return results
}

/**
 * @param {{ label: string; description?: string; keywords?: string[] }[]} rules
 * @returns {import('./themes.js').ThemeRule[]}
 */
function toThemeRules(rules) {
  return (rules || []).map((r) => ({
    id: r.label,
    label: r.label,
    description: r.description || '',
    keywords: r.keywords || [],
  }))
}

/**
 * @param {string} text
 * @param {{ label: string; description?: string; keywords?: string[] }[]} rules
 */
export function matchSharedLabel(text, rules) {
  const labels = matchThemesByDescription(text, toThemeRules(rules))
  return labels[0] || '未分类'
}

/**
 * @param {string[]} texts
 * @param {{ label: string; description?: string; keywords?: string[] }[]} rules
 * @param {import('./storage.js').AppSettings} settings
 * @param {(done: number, total: number) => void} [onProgress]
 * @param {string[]} [existingLabels]
 */
export async function matchSharedLabelsBatch(
  texts,
  rules,
  settings,
  onProgress,
  existingLabels = [],
) {
  const themeRules = toThemeRules(rules)
  if (!canUseSemanticMatch(settings) || !usesLlmThemeMatch(settings?.themeMatchMode)) {
    return texts.map((t, i) => {
      const existing = existingLabels[i]?.trim()
      if (existing && existing !== '未分类') {
        return { label: existing, overflowOrigin: null }
      }
      return { label: matchSharedLabel(t, rules), overflowOrigin: null }
    })
  }
  return matchSharedDimensionHybridBatch(texts, themeRules, settings, onProgress, existingLabels)
}

/** @deprecated 请求场景请使用 {@link matchRequestScenesForRecords} */

export { buildTaggingTextForRecord as taggingTextForRecord } from './taggingText.js'

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {import('./storage.js').AppSettings} settings
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function enrichRecordsWithSharedDimensions(records, settings, onProgress) {
  if (!records.length) return records

  const requestRules = getSharedRequestScenes()
  const problemRules = getSharedProblemTypes()
  const texts = records.map(buildTaggingTextForRecord)
  const total = records.length

  const requestResults = await matchRequestScenesForRecords(
    records,
    texts,
    requestRules,
    settings,
    (done, t) => {
      onProgress?.(Math.floor(done / 2), t)
    },
  )
  const problemResults = await matchProblemTypesForRecords(
    records,
    texts,
    problemRules,
    settings,
    (done, t) => {
      onProgress?.(Math.floor(total / 2 + done / 2), t)
    },
  )

  return records.map((r, i) => {
    const requestScene = requestResults[i]?.label || r.requestScene || '未分类'
    const problemType = problemResults[i]?.label || r.problemType || '未分类'

    captureRequestSceneCandidateIfNeeded({
      requestScene,
      requestScenes: requestRules,
      recordId: r.id,
      sourceText: texts[i],
      insightPeriodId: r.insightPeriodId,
      dataSourceType: r.dataSourceType,
      origin: requestResults[i]?.overflowOrigin ?? 'local_overflow',
    })
    captureProblemTypeCandidateIfNeeded({
      problemType,
      problemTypes: problemRules,
      recordId: r.id,
      sourceText: texts[i],
      insightPeriodId: r.insightPeriodId,
      dataSourceType: r.dataSourceType,
      origin: problemResults[i]?.overflowOrigin ?? 'local_overflow',
    })

    return { ...r, requestScene, problemType }
  })
}
