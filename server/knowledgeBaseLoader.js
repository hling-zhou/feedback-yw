/**
 * 产品业务知识库加载与检索（服务端）。
 *
 * KB 存储于数据库 `knowledge_bases` 表（payload 为整份 KB JSON），经一次性 seed
 * 或前端上传入库。每个 JSON 含 productLine（如 eip），details[] 为特性数组
 * （name/description/aliases/scenarios/globalRules）。
 *
 * 检索为关键词匹配：feature name/alias 命中痛点文本得高分，工单标签 token
 * 出现在 feature 文本中得 1 分。取 top features，每个返回 name + description +
 * 命中的 top 2 globalRules，总长截断到 budget。
 */

import { listKnowledgeBaseRows } from './knowledgeBaseRepository.js'

/** @type {Map<string, { productLine: string; productName: string; details: any[] }> | null} */
let cache = null

/**
 * 从数据库加载所有知识库，按 productLine 索引。结果缓存，上传/删除后需 clearKnowledgeBaseCache。
 * @returns {Map<string, { productLine: string; productName: string; details: any[] }>}
 */
export function loadKnowledgeBases() {
  if (cache) return cache
  const map = new Map()
  let rows = []
  try {
    rows = listKnowledgeBaseRows()
  } catch {
    // DB 未就绪时返回空，不阻断
    cache = map
    return map
  }
  for (const row of rows) {
    try {
      const data = JSON.parse(row.payload)
      const productLine = String(data?.productLine ?? '').trim().toLowerCase()
      if (!productLine) continue
      if (!map.has(productLine)) {
        map.set(productLine, {
          productLine,
          productName: String(data?.productName || row.productName || ''),
          details: Array.isArray(data?.details) ? data.details : [],
        })
      }
    } catch {
      // 跳过损坏 payload
    }
  }
  cache = map
  return map
}

/** 清除内存缓存（上传/删除/seed 后调用）。 */
export function clearKnowledgeBaseCache() {
  cache = null
}

/**
 * @param {string} productKey
 * @returns {{ productLine: string; productName: string; details: any[] } | null}
 */
export function getKnowledgeBase(productKey) {
  const key = String(productKey ?? '').trim().toLowerCase()
  if (!key) return null
  return loadKnowledgeBases().get(key) || null
}

/**
 * 收集 feature 的可检索文本（name + aliases + description + 场景名 + 规则内容）。
 * @param {any} feature
 * @returns {string}
 */
function featureHaystack(feature) {
  const parts = [feature?.name, feature?.aliases, feature?.description]
  const scenarios = feature?.scenarios
  if (Array.isArray(scenarios)) {
    for (const s of scenarios) parts.push(s?.name, s?.description)
  }
  const rules = feature?.globalRules
  if (Array.isArray(rules)) {
    for (const r of rules) parts.push(r?.content)
  }
  return parts.map((p) => String(p ?? '')).join('\n')
}

/**
 * feature name/alias 是否作为子串出现在 text 中。
 * @param {any} feature
 * @param {string} text
 * @returns {boolean}
 */
function featureNameInText(feature, text) {
  if (!text) return false
  const names = [feature?.name, ...(feature?.aliases ? String(feature.aliases).split(/[,，\s]+/) : [])]
    .map((n) => String(n ?? '').trim())
    .filter(Boolean)
  return names.some((n) => n.length >= 2 && text.includes(n))
}

/**
 * 纯函数：给一个 feature 对查询打分。
 * @param {any} feature
 * @param {string[]} queryTokens 工单标签 token（journey/problemType/requestScene/spec）
 * @param {string} text 工单痛点/请求文本
 * @returns {number}
 */
export function scoreFeature(feature, queryTokens, text) {
  let score = 0
  if (featureNameInText(feature, text)) score += 5
  const haystack = featureHaystack(feature)
  for (const token of queryTokens || []) {
    const t = String(token ?? '').trim()
    if (t && haystack.includes(t)) score += 1
  }
  return score
}

/**
 * 检索某产品知识库的相关片段。
 * @param {string} productKey
 * @param {string} text 工单文本（痛点+请求+raw 片段）
 * @param {string[]} tags 工单标签
 * @param {{ budget?: number }} [options]
 * @returns {{ title: string; content: string; productKey: string }[]}
 */
export function retrieveSnippets(productKey, text, tags, options = {}) {
  const budget = options.budget ?? 1500
  const kb = getKnowledgeBase(productKey)
  if (!kb || !kb.details.length) return []
  const queryTokens = (tags || []).map((t) => String(t ?? '').trim()).filter(Boolean)
  const textStr = String(text ?? '')

  const scored = kb.details
    .map((feature) => ({ feature, score: scoreFeature(feature, queryTokens, textStr) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  /** @type {{ title: string; content: string; productKey: string }[]} */
  const snippets = []
  let used = 0
  for (const { feature } of scored) {
    const name = String(feature?.name ?? '').trim()
    const desc = String(feature?.description ?? '').trim()
    /** 规则按命中 token 排序，取 top 2 */
    const rules = (feature?.globalRules || [])
      .map((r) => ({
        r,
        score: scoreFeature(
          { name: '', aliases: '', description: '', scenarios: [], globalRules: [r] },
          queryTokens,
          '',
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((x) => String(x.r?.content ?? '').trim())
      .filter(Boolean)
    const scenarioNames = (feature?.scenarios || [])
      .map((s) => String(s?.name ?? '').trim())
      .filter(Boolean)
    const contentParts = [desc, ...scenarioNames.map((n) => `场景：${n}`), ...rules.map((r) => `规则：${r}`)].filter(Boolean)
    const content = contentParts.join('\n')
    if (!content) continue
    const remaining = budget - used
    if (remaining <= 0) break
    const trimmed = content.slice(0, remaining)
    snippets.push({ title: name, content: trimmed, productKey: kb.productLine })
    used += trimmed.length
  }
  return snippets
}
