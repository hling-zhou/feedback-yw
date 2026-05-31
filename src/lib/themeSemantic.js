import { DEFAULT_THEME_MATCH_MODE } from './storage.js'
import { matchThemes } from './themes.js'
import {
  getLlmCompletionText,
  isLlmAvailable,
  llmChatCompletion,
  parseLlmMessageContent,
} from './llmClient.js'

/**
 * @typedef {import('./themes.js').ThemeRule} ThemeRule
 * @typedef {{ llmBaseUrl?: string; llmModel?: string; llmServerConfigured?: boolean }} LlmConfig
 */

const DEFAULT_MODEL = 'gpt-4o-mini'

/**
 * @param {string} label
 * @param {ThemeRule[]} rules
 */
export function isInThemeLibrary(label, rules) {
  const normalized = (label || '').trim()
  if (!normalized) return false
  return (rules || []).some((r) => (r.label || '').trim() === normalized)
}

/**
 * LLM 或打标结果中的库外主题名（待复核采纳）
 * @param {string} label
 * @param {ThemeRule[]} rules
 */
export function isLlmProposedThemeLabel(label, rules) {
  const normalized = (label || '').trim()
  if (!normalized || normalized === '未分类') return false
  return !isInThemeLibrary(normalized, rules)
}

/**
 * 合并本地与 LLM 的单一共享维度标签（请求场景 / 问题类型）
 * @param {string} local
 * @param {string} llm
 * @param {ThemeRule[]} rules
 */
export function mergeSharedDimensionLabel(local, llm, rules) {
  const l = (local || '').trim() || '未分类'
  const g = (llm || '').trim() || '未分类'

  if (isInThemeLibrary(g, rules)) return g

  if (isLlmProposedThemeLabel(g, rules)) return g

  const hasRules = (rules || []).some((r) => r.label?.trim())
  if (!hasRules && g !== '未分类') return g

  if (isLlmProposedThemeLabel(l, rules)) return l

  if (g !== '未分类') return g
  if (l !== '未分类') return l
  return '未分类'
}

/**
 * @param {string} finalLabel
 * @param {string} local
 * @param {string} llm
 * @param {ThemeRule[]} rules
 * @returns {'llm' | 'local_overflow' | null}
 */
export function resolveThemeOverflowOrigin(finalLabel, local, llm, rules) {
  if (!isLlmProposedThemeLabel(finalLabel, rules)) return null
  const g = (llm || '').trim()
  if (finalLabel === g && isLlmProposedThemeLabel(g, rules)) return 'llm'
  return 'local_overflow'
}

/**
 * @param {string[]} texts
 * @param {ThemeRule[]} rules
 * @param {LlmConfig} config
 * @param {(done: number, total: number) => void} [onProgress]
 * @param {string[]} [existingLabels] 记录上已有的标签（如导入列 / 本地初判）
 */
export async function matchSharedDimensionHybridBatch(
  texts,
  rules,
  config,
  onProgress,
  existingLabels = [],
) {
  const localFromText = texts.map((t) => matchThemesByDescription(t, rules)[0] || '未分类')
  const local = texts.map((_, i) => {
    const existing = existingLabels[i]?.trim()
    if (existing && existing !== '未分类') return existing
    return localFromText[i]
  })

  if (!canUseSemanticMatch(config) || !usesLlmThemeMatch(config?.themeMatchMode)) {
    return local.map((label) => ({ label, overflowOrigin: null }))
  }

  const BATCH = 8
  /** @type {{ label: string; overflowOrigin: 'llm' | 'local_overflow' | null }[]} */
  const results = []

  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH)
    const localChunk = local.slice(i, i + BATCH)
    try {
      const llmBatch = await callLlmClassifyBatch(chunk, rules, config, localChunk)
      results.push(
        ...chunk.map((_, j) => {
          const llmLabel = llmBatch[j]?.[0] || '未分类'
          const label = mergeSharedDimensionLabel(localChunk[j], llmLabel, rules)
          return {
            label,
            overflowOrigin: resolveThemeOverflowOrigin(label, localChunk[j], llmLabel, rules),
          }
        }),
      )
    } catch (err) {
      console.warn('共享维度混合打标失败，该批仅用本地:', err)
      results.push(...localChunk.map((label) => ({ label, overflowOrigin: null })))
    }
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length)
  }

  return results
}

/**
 * 仅调用 LLM 做共享维度单标签分类（供 config 优先、未命中再走 LLM 的流程使用）
 * @param {string[]} texts
 * @param {ThemeRule[]} rules
 * @param {LlmConfig} config
 * @param {string[]} [localHints]
 */
export async function matchSharedDimensionLlmBatch(texts, rules, config, localHints = []) {
  const hints = localHints.map((h) => {
    const label = (h || '').trim()
    return label && label !== '未分类' ? [label] : []
  })
  return callLlmClassifyBatch(texts, rules, config, hints)
}

/**
 * @param {ThemeRule[]} rules
 * @param {LlmConfig} config
 */
export function canUseSemanticMatch(config) {
  return isLlmAvailable(config)
}

/**
 * @param {import('./storage.js').ThemeMatchMode | string} mode
 */
export function usesLlmThemeMatch(mode) {
  return mode === 'semantic' || mode === 'hybrid'
}

/**
 * 合并本地与 LLM 主题结果（取并集，去掉「未分类」后再合并）
 * @param {string[]} local
 * @param {string[]} llm
 */
export function mergeThemeLists(local, llm) {
  const pick = (arr) => (arr || []).filter((t) => t && t !== '未分类')
  const merged = [...new Set([...pick(local), ...pick(llm)])]
  if (merged.length > 0) return merged
  const fallback = pick(local).length ? pick(local) : pick(llm)
  return fallback.length > 0 ? fallback : ['未分类']
}

/**
 * 无 API 时的轻量语义：综合关键词 + 主题解释文本做相似度打分
 * @param {string} text
 * @param {ThemeRule[]} rules
 */
export function matchThemesByDescription(text, rules) {
  if (!text?.trim()) return ['未分类']

  const scores = rules
    .map((rule) => ({ label: rule.label, score: scoreRule(text, rule) }))
    .filter((s) => s.label?.trim() && s.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scores.length === 0) return matchThemes(text, rules)

  const top = scores.filter((s) => s.score >= Math.max(2, scores[0].score * 0.6))
  return top.map((s) => s.label)
}

/**
 * @param {string} text
 * @param {ThemeRule} rule
 */
function scoreRule(text, rule) {
  const lower = text.toLowerCase()
  let score = 0

  for (const kw of rule.keywords || []) {
    if (kw && lower.includes(kw.toLowerCase())) score += 3
  }

  const descTokens = tokenize(`${rule.label} ${rule.description || ''}`)
  const textTokens = tokenize(text)
  const textSet = new Set(textTokens)

  for (const t of descTokens) {
    if (textSet.has(t)) score += 2
    if (t.length >= 2 && lower.includes(t)) score += 1
  }

  return score
}

/**
 * @param {string} s
 * @returns {string[]}
 */
function tokenize(s) {
  const re = /[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}/g
  return (s.match(re) || []).map((t) => t.toLowerCase())
}

/**
 * @param {string} text
 * @param {ThemeRule[]} rules
 * @param {LlmConfig} config
 * @returns {Promise<string[]>}
 */
export async function matchThemesSemantic(text, rules, config) {
  if (!text?.trim()) return ['未分类']
  if (!canUseSemanticMatch(config)) {
    return matchThemesByDescription(text, rules)
  }

  try {
    const labels = await callLlmClassify(text, rules, config)
    return labels.length > 0 ? labels : ['未分类']
  } catch (err) {
    console.warn('语义分类失败，回退到解释+关键词匹配:', err)
    return matchThemesByDescription(text, rules)
  }
}

/**
 * 批量语义分类（减少请求次数）
 * @param {string[]} texts
 * @param {ThemeRule[]} rules
 * @param {LlmConfig} config
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function matchThemesSemanticBatch(texts, rules, config, onProgress) {
  if (!canUseSemanticMatch(config)) {
    return texts.map((t) => matchThemesByDescription(t, rules))
  }

  const BATCH = 8
  /** @type {string[][]} */
  const results = []

  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH)
    try {
      const batch = await callLlmClassifyBatch(chunk, rules, config)
      results.push(...batch)
    } catch (err) {
      console.warn('批量语义分类失败，该批回退:', err)
      results.push(...chunk.map((t) => matchThemesByDescription(t, rules)))
    }
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length)
  }

  return results
}

/**
 * 混合匹配：本地解释+关键词 与 LLM 语义结果合并
 * @param {string} text
 * @param {ThemeRule[]} rules
 * @param {LlmConfig} config
 */
export async function matchThemesHybrid(text, rules, config) {
  const local = matchThemesByDescription(text, rules)
  if (!canUseSemanticMatch(config)) return local

  try {
    const llm = await matchThemesSemantic(text, rules, config)
    return mergeThemeLists(local, llm)
  } catch (err) {
    console.warn('混合模式 LLM 失败，仅使用本地匹配:', err)
    return local
  }
}

/**
 * @param {string[]} texts
 * @param {ThemeRule[]} rules
 * @param {LlmConfig} config
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function matchThemesHybridBatch(texts, rules, config, onProgress) {
  const localResults = texts.map((t) => matchThemesByDescription(t, rules))
  if (!canUseSemanticMatch(config)) return localResults

  const BATCH = 8
  /** @type {string[][]} */
  const results = []

  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH)
    const localChunk = localResults.slice(i, i + BATCH)
    try {
      const llmBatch = await callLlmClassifyBatch(chunk, rules, config, localChunk)
      results.push(
        ...chunk.map((_, j) => mergeThemeLists(localChunk[j], llmBatch[j])),
      )
    } catch (err) {
      console.warn('混合模式批量 LLM 失败，该批仅用本地:', err)
      results.push(...localChunk)
    }
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length)
  }

  return results
}

/**
 * @param {string} text
 * @param {ThemeRule[]} rules
 * @param {LlmConfig} config
 */
async function callLlmClassify(text, rules, config) {
  const batch = await callLlmClassifyBatch([text], rules, config)
  return batch[0] || ['未分类']
}

/**
 * @param {string[]} texts
 * @param {ThemeRule[]} rules
 * @param {LlmConfig} config
 */
/**
 * @param {string[]} texts
 * @param {ThemeRule[]} rules
 * @param {LlmConfig} config
 * @param {string[][]} [localHints] 混合模式下的本地初判
 */
async function callLlmClassifyBatch(texts, rules, config, localHints) {
  const themeList = rules
    .filter((r) => r.label?.trim())
    .map((r) => ({
      label: r.label,
      description: r.description || '（无说明）',
      keywords: (r.keywords || []).join('、') || '无',
    }))

  const allowedLabels = themeList.map((t) => t.label)

  const hasHints = localHints?.some((h) => h?.filter((t) => t !== '未分类').length)
  const hasRules = themeList.length > 0

  const systemPrompt = hasRules
    ? `你是用户反馈主题分类助手。根据每条反馈的语义，从给定主题列表中选择最匹配的主题（每条仅一个主标签）。
只返回 JSON，不要其他文字。格式：{"results":[{"index":0,"themes":["主题A"]},...]}
规则：
- 优先从主题列表中选择 themes[0]
- 若列表中无合适项，可建议一个新的简洁中文主题名作为 themes[0]，系统将收录为待复核标签
- 建议的新名称应贴合工单语义，勿与列表中已有名称重复
- 若无任何合适项且无法建议新名，themes 为 ["未分类"]
- 依据主题「解释」的语义含义判断，不要只做字面关键词匹配
${hasHints ? '- 若提供了「本地初判」，可采纳、补充或修正；以语义与工单证据为准' : ''}`
    : `你是用户反馈主题分类助手。当前尚未配置主题标签库（列表为空）。
请根据每条反馈的语义，建议最合适的一个中文主题名作为 themes[0]，将进入「待复核标签」供管理员采纳。
只返回 JSON：{"results":[{"index":0,"themes":["主题A"]},...]}
规则：
- themes[0] 为建议新增的标签名称（中文、简洁），应贴合工单语义
- 仅当正文完全无法判断时，themes 为 ["未分类"]
${hasHints ? '- 若提供「本地初判」且非「未分类」，可参考其语义' : ''}`

  const userPrompt = hasRules
    ? `主题列表（含解释）：
${themeList.map((t, i) => `${i + 1}. ${t.label}\n   解释：${t.description}\n   参考词：${t.keywords}`).join('\n')}

优先从列表选择；若无合适项可建议新名称。允许值：${allowedLabels.join('、')}、未分类、或新建议名称

待分类反馈：
${texts
  .map((t, i) => {
    const hint = localHints?.[i]?.filter((x) => x !== '未分类').join('、')
    const hintLine = hint ? `\n   本地初判（解释+关键词）：${hint}` : ''
    return `[${i}] ${t.slice(0, 800)}${hintLine}`
  })
  .join('\n\n')}`
    : `主题列表：（当前为空，请根据工单正文建议新的主题名称）

待分类反馈：
${texts
  .map((t, i) => {
    const hint = localHints?.[i]?.filter((x) => x !== '未分类').join('、')
    const hintLine = hint ? `\n   本地初判：${hint}` : ''
    return `[${i}] ${t.slice(0, 800)}${hintLine}`
  })
  .join('\n\n')}`

  const data = await llmChatCompletion(config, {
    model: config.llmModel || DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })
  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const items = parsed.results || parsed.items || []

  return texts.map((_, i) => {
    const item = items.find((r) => r.index === i) || items[i]
    const themes = (item?.themes || [])
      .map((t) => String(t || '').trim())
      .filter(Boolean)
    const primary = themes[0] || '未分类'
    return [primary]
  })
}

/**
 * @param {string} text
 * @param {ThemeRule[]} rules
 * @param {import('./storage.js').AppSettings} settings
 */
export async function matchThemesForSettings(text, rules, settings) {
  const mode = settings.themeMatchMode || DEFAULT_THEME_MATCH_MODE

  if (mode === 'keyword') {
    return matchThemes(text, rules)
  }

  if (mode === 'hybrid') {
    return matchThemesHybrid(text, rules, settings)
  }

  if (mode === 'semantic' && canUseSemanticMatch(settings)) {
    return matchThemesSemantic(text, rules, settings)
  }

  return matchThemesByDescription(text, rules)
}
