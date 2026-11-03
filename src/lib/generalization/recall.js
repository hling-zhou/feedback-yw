import { searchRecordsRange } from '../../../server/assistantSearchIndex.js'

/**
 * 举一反三召回（DESIGN-20261102-1.md §3.2 / v3.2：全库召回不限同产品）。
 *
 * 拷贝自 src/lib/observation/recall.js 后按 gen 差异改造：
 * - 去锚点通道（举一反三证据域只有工单，无用后即评 originalTicketId 场景）；
 * - 无产品约束（范畴定义"共性=非单产品特例"与同产品约束矛盾——v3.2 定稿全库召回）；
 * - 画像文本只服务工单（痛点 + 客户请求）。
 *
 * 通道：①FTS trigram 字面召回——新工单画像词检索全库，命中记录反查其 confirmed 归属 issue；
 *      ②keywords 通道——issue 维护关键词直接子串匹配画像文本。
 *
 * 召回宁多勿漏：多通道并集；已 dismissed / confirmed / pending 的组合由 putLink 优先级矩阵
 * 兜底过滤，但本层也先过滤一遍以省 LLM 成本（调用方负责预过滤）。
 */

/**
 * @typedef {Object} GeneralizationRecallIssue
 * @property {string} issueId
 * @property {string} productKey
 * @property {string} title
 * @property {string} summary
 * @property {string[]} keywords
 * @property {string[]} confirmedTicketIds
 * @property {string[]} confirmedRecordIds - 全部 confirmed 记录 id（FTS 反查用）
 */

/**
 * @typedef {Object} GeneralizationRecallHit
 * @property {string} issueId
 * @property {'fts' | 'keywords'} channel - gen 无锚点通道
 * @property {'high' | 'medium' | 'low'} confidence - 字面/关键词 = medium 候选基线
 * @property {string} excerpt - 命中摘录（落 match_reason 的证据）
 */

/**
 * 新工单画像文本（供 FTS 查询词与关键词匹配）。
 * 工单 = 痛点 + 客户请求（举一反三对象域只有工单——设计 §0.4）。
 * @param {unknown} recordInput
 * @returns {string}
 */
export function buildGeneralizationRecallText(recordInput) {
  const record = /** @type {Record<string, unknown>} */ (recordInput && typeof recordInput === 'object' ? recordInput : {})
  const parts = []
  parts.push(String(record.painPoint || record.problemSummary || '').trim())
  parts.push(String(record.customerRequest || '').trim())
  return parts.filter(Boolean).join('\n')
}

/**
 * issue 关键词通道匹配。
 * @param {string} recallText
 * @param {string[]} keywords
 * @returns {boolean}
 */
export function generalizationKeywordsMatch(recallText, keywords) {
  const text = recallText || ''
  if (!text) return false
  return (keywords || []).some((kw) => {
    const k = String(kw || '').trim()
    if (!k) return false
    return text.includes(k)
  })
}

/**
 * 从 FTS 结果提取查询关键词（画像文本里挑最长的 2-4 个词做查询，避免整句入 FTS）。
 * @param {string} recallText
 * @returns {string[]}
 */
export function deriveGeneralizationFtsQueries(recallText) {
  const text = (recallText || '').trim()
  if (!text) return []
  const pieces = text
    .split(/[，。；、！？\n\r\t,;.!?{}\[\]()（）]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2)
  const uniq = [...new Set(pieces)]
  uniq.sort((a, b) => b.length - a.length)
  return uniq.slice(0, 4)
}

/**
 * 两通道召回主函数（全库——不限产品，v3.2）。
 *
 * @param {Object} params
 * @param {{ recordId: string, recordDataSource: string, productKey: string, ticketId: string }} params.target
 * @param {unknown} params.record - 完整工单记录（画像文本源）
 * @param {GeneralizationRecallIssue[]} params.issues - 全库 in_progress issue 列表（调用方加载）
 * @param {string} [params.importMonthFrom]
 * @param {string} [params.importMonthTo]
 * @param {{ searchRange?: typeof searchRecordsRange }} [params.deps] - 测试注入
 * @returns {GeneralizationRecallHit[]}
 */
export function recallGeneralizationCandidates(params) {
  const { record, issues } = params
  if (!issues?.length) return []
  const recallText = buildGeneralizationRecallText(record)
  if (!recallText.trim()) return []

  /** @type {Map<string, GeneralizationRecallHit>} */
  const hits = new Map()
  const addHit = (issueId, channel, confidence, excerpt) => {
    const prev = hits.get(issueId)
    if (prev && channel === 'fts' && prev.channel !== 'fts') return // 已有更专门通道（keywords），保留
    hits.set(issueId, { issueId, channel, confidence, excerpt: excerpt.slice(0, 120) })
  }

  // ② keywords 通道
  for (const issue of issues) {
    if (issue.keywords?.length && generalizationKeywordsMatch(recallText, issue.keywords)) {
      const hitKw = issue.keywords.find((kw) => recallText.includes(String(kw || '').trim()))
      addHit(issue.issueId, 'keywords', 'medium', `命中关键词「${hitKw}」`)
    }
  }

  // ① FTS 通道：画像词检索全库（不限产品）→ 命中记录反查 confirmed issue
  const searchRange = params.deps?.searchRange || searchRecordsRange
  if (hits.size < issues.length) {
    const queries = deriveGeneralizationFtsQueries(recallText)
    const recordIdToIssue = new Map()
    for (const issue of issues) {
      for (const rid of issue.confirmedRecordIds || []) recordIdToIssue.set(rid, issue.issueId)
    }
    for (const query of queries.slice(0, 2)) {
      let result
      try {
        result = searchRange({
          importMonthFrom: params.importMonthFrom,
          importMonthTo: params.importMonthTo,
          query,
          limit: 20,
        })
      } catch {
        result = null
      }
      if (!result?.results?.length) continue
      for (const row of result.results) {
        const issueId = recordIdToIssue.get(String(row.recordId))
        if (!issueId) continue
        addHit(issueId, 'fts', 'medium', `字面命中：${row.snippet || query}`)
      }
    }
  }

  return [...hits.values()]
}

/**
 * 举一反三候选池（DESIGN §0.4 / TASKS G2-4 对象筛选）：
 * 只判投诉/咨询工单（评价不参与——工单本身就是问题域，无需负面池清洗）。
 *
 * @param {Object} params
 * @param {unknown[]} params.records
 * @returns {Array<{ recordId: string, recordDataSource: 'complaint_ticket' | 'consultation_ticket', productKey: string, productName: string, ticketId: string }>}
 */
export function resolveGeneralizationScanTargets({ records }) {
  /** @type {Array<{ recordId: string, recordDataSource: 'complaint_ticket' | 'consultation_ticket', productKey: string, productName: string, ticketId: string }>} */
  const targets = []
  for (const recordInput of records || []) {
    if (!recordInput || typeof recordInput !== 'object') continue
    const record = /** @type {Record<string, unknown>} */ (recordInput)
    const recordId = String(record.id || '').trim()
    if (!recordId) continue
    const dataSourceType = String(record.dataSourceType || '').trim()
    if (dataSourceType !== 'complaint_ticket' && dataSourceType !== 'consultation_ticket') continue
    targets.push({
      recordId,
      recordDataSource: dataSourceType,
      productKey: String(record.productKey || '').trim(),
      productName: String(record.product || '').trim(),
      ticketId: String(record.ticketId || ''),
    })
  }
  return targets
}
