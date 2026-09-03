/**
 * 知识库检索客户端：构建检索 query、识别跨产品、批量拉取片段。
 *
 * 优先用投诉产品 productKey 的知识库；若痛点文本中提到其他产品名/别名，
 * 补充该产品 productKey 一并检索。检索失败返回空，不阻断 LLM。
 */

import { apiFetch } from './apiClient.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {{ title: string; content: string; productKey: string }} Snippet */

/**
 * 收集一个目录产品的所有可匹配字符串（name + match + spec name/match）。
 * @param {any} product
 * @returns {string[]}
 */
function productCandidateNames(product) {
  const out = []
  const push = (v) => {
    const s = String(v ?? '').trim()
    if (s.length >= 2) out.push(s)
  }
  push(product?.name)
  if (Array.isArray(product?.match)) product.match.forEach(push)
  if (Array.isArray(product?.specs)) {
    for (const spec of product.specs) {
      push(spec?.name)
      if (Array.isArray(spec?.match)) spec.match.forEach(push)
    }
  }
  return out
}

/**
 * 扫描文本中出现的其他产品名/别名，返回 secondary productKey 列表（排除主产品）。
 * @param {string} text
 * @param {any[]} catalogProducts
 * @param {string} [primaryProductKey]
 * @returns {string[]}
 */
export function detectSecondaryProductKeys(text, catalogProducts, primaryProductKey) {
  const haystack = String(text ?? '')
  if (!haystack) return []
  const primary = String(primaryProductKey ?? '').trim().toLowerCase()
  /** @type {Set<string>} */
  const found = new Set()
  for (const product of catalogProducts || []) {
    const key = String(product?.key ?? '').trim().toLowerCase()
    if (!key || key === primary) continue
    const candidates = productCandidateNames(product)
    if (candidates.some((c) => haystack.includes(c))) {
      found.add(key)
    }
  }
  return [...found]
}

/**
 * 为一条工单记录构建知识库检索 query。
 * @param {FeedbackRecord} record
 * @param {any[]} [catalogProducts]
 * @returns {{ productKeys: string[]; text: string; tags: string[] }}
 */
export function buildKnowledgeQuery(record, catalogProducts = []) {
  const primary = String(record?.productKey ?? '').trim().toLowerCase()
  const text = [record?.painPoint, record?.customerRequest, String(record?.rawText ?? '').slice(0, 2000)]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n')
  const tags = [
    record?.journeyL1,
    record?.journeyL2,
    record?.problemType,
    record?.requestScene,
    record?.productSpec,
  ]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
  const secondary = detectSecondaryProductKeys(text, catalogProducts, primary)
  /** @type {string[]} */
  const productKeys = []
  for (const k of [primary, ...secondary]) {
    if (k && !productKeys.includes(k)) productKeys.push(k)
  }
  return { productKeys, text, tags }
}

/**
 * 批量检索知识库片段。失败时返回每 query 空数组，不抛错。
 * @param {{ productKeys: string[]; text: string; tags: string[] }[]} queries
 * @returns {Promise<Snippet[][]>}
 */
export async function retrieveKnowledgeSnippets(queries) {
  if (!queries?.length) return []
  try {
    const data = /** @type {{ results: Snippet[][] }} */ (
      await apiFetch('/api/knowledge-base/retrieve', {
        method: 'POST',
        body: JSON.stringify({ queries }),
      })
    )
    return Array.isArray(data?.results) ? data.results : queries.map(() => [])
  } catch (err) {
    console.warn('[knowledge-base] 检索失败，降级为空片段:', err)
    return queries.map(() => [])
  }
}

/**
 * 把片段集格式化为 prompt 注入文本。
 * @param {Snippet[]} snippets
 * @returns {string}
 */
export function formatKnowledgeSnippetsForPrompt(snippets) {
  if (!snippets?.length) return ''
  return snippets
    .map((s) => `【${s.productKey}】${s.title}\n${s.content}`)
    .join('\n\n')
}

// ─── 管理接口（Settings 页面用） ───────────────────────────────

/**
 * @typedef {Object} KnowledgeBaseSummary
 * @property {string} productKey
 * @property {string} productName
 * @property {string} exportDate
 * @property {string} uploadedByUsername
 * @property {string} uploadedAt
 * @property {number} sizeBytes
 */

/**
 * 列出已上传知识库。
 * @returns {Promise<KnowledgeBaseSummary[]>}
 */
export async function listKnowledgeBases() {
  const data = await apiFetch('/api/knowledge-base')
  return Array.isArray(data?.items) ? /** @type {KnowledgeBaseSummary[]} */ (data.items) : []
}

/**
 * 上传/替换知识库。payload 为整份 KB JSON 对象（含 productLine / details）。
 * @param {Record<string, unknown>} kbObject
 * @returns {Promise<{ item: KnowledgeBaseSummary }>}
 */
export async function uploadKnowledgeBase(kbObject) {
  return apiFetch('/api/knowledge-base/upload', {
    method: 'POST',
    body: JSON.stringify(kbObject),
  })
}

/**
 * @param {string} productKey
 * @returns {Promise<{ ok: boolean; productKey: string }>}
 */
export async function deleteKnowledgeBase(productKey) {
  return apiFetch(`/api/knowledge-base/${encodeURIComponent(productKey)}`, {
    method: 'DELETE',
  })
}
