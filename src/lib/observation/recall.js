import { searchRecordsRange } from '../../../server/assistantSearchIndex.js'

/**
 * 三通道召回（DESIGN §3.1 步 2 / §3.2 C2）：同产品 issue 候选集。
 *
 * 通道：
 * ①FTS trigram 字面召回——拿「新记录画像文本」检索全库记录，命中记录反查其 confirmed 归属 issue；
 * ②keywords 通道——issue 维护关键词直接子串匹配画像文本；
 * ③锚点通道——用后即评 originalTicketId 命中 issue 已挂工单 → high（跳过 LLM 的强信号）。
 *
 * 召回宁多勿漏：多通道并集；已 dismissed / 已 confirmed / 已 pending 的组合由 putLink 优先级矩阵兜底过滤，
 * 但本层也先过滤一遍以省 LLM 成本。
 *
 * @typedef {import('./scanTargets.js').ObservationScanTarget} ObservationScanTarget
 */

/**
 * @typedef {Object} ObservationRecallIssue
 * @property {string} issueId
 * @property {string} productKey
 * @property {string} title
 * @property {string} summary
 * @property {string[]} keywords
 * @property {string[]} confirmedTicketIds - confirmed 工单号（锚点通道用）
 * @property {string[]} confirmedRecordIds - 全部 confirmed 记录 id（FTS 反查用）
 */

/**
 * @typedef {Object} ObservationRecallHit
 * @property {string} issueId
 * @property {'fts' | 'keywords' | 'anchor'} channel
 * @property {'high' | 'medium' | 'low'} confidence - 锚点=high；字面/关键词=medium 候选基线
 * @property {string} excerpt - 命中摘录（落 match_reason 的证据）
 */

/**
 * 新记录画像文本（供 FTS 查询词与关键词匹配）。
 * 工单 = 痛点 + 客户请求；评价 = 原文 + 原因标签。
 * @param {unknown} record
 * @returns {string}
 */
export function buildRecallText(record) {
  const parts = []
  const type = String(record?.dataSourceType || '')
  if (type === 'post_use_rating') {
    parts.push(String(record?.commentText || '').trim())
    parts.push(String(record?.rawText || '').trim())
    parts.push(String(record?.lowScoreReason || '').trim())
  } else {
    parts.push(String(record?.painPoint || record?.problemSummary || '').trim())
    parts.push(String(record?.customerRequest || '').trim())
  }
  return parts.filter(Boolean).join('\n')
}

/**
 * issue 关键词通道匹配。
 * @param {string} recallText
 * @param {string[]} keywords
 * @returns {boolean}
 */
export function keywordsMatch(recallText, keywords) {
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
export function deriveFtsQueries(recallText) {
  const text = (recallText || '').trim()
  if (!text) return []
  // 按标点/空白切段，取长度 ≥2 的段；中文 trigram 对短词也能命中
  const pieces = text
    .split(/[，。；、！？\n\r\t,;.!?{}\[\]()（）]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2)
  // 去重并取最长的 4 个（长词区分度高）
  const uniq = [...new Set(pieces)]
  uniq.sort((a, b) => b.length - a.length)
  return uniq.slice(0, 4)
}

/**
 * 三通道召回主函数。
 *
 * @param {Object} params
 * @param {ObservationScanTarget} params.target - 候选池条目
 * @param {unknown} params.record - 完整记录（画像文本源）
 * @param {ObservationRecallIssue[]} params.issues - 同产品 issue 列表（调用方过滤好 productKey）
 * @param {string} [params.importMonthFrom] - FTS 检索范围起（默认近 12 个月由调用方定）
 * @param {string} [params.importMonthTo]
 * @param {{ searchRange?: typeof searchRecordsRange }} [params.deps] - 测试注入
 * @returns {ObservationRecallHit[]}
 */
export function recallObservationCandidates(params) {
  const { target, record, issues } = params
  if (!issues?.length) return []
  const recallText = buildRecallText(record)
  if (!recallText.trim()) return []

  /** @type {Map<string, ObservationRecallHit>} */
  const hits = new Map()
  const addHit = (issueId, channel, confidence, excerpt) => {
    const prev = hits.get(issueId)
    if (prev && prev.confidence === 'high') return // high 不降级
    if (prev && channel === 'fts' && prev.channel !== 'fts') return // 已有更专门通道，保留
    hits.set(issueId, { issueId, channel, confidence, excerpt: excerpt.slice(0, 120) })
  }

  // ③ 锚点通道：originalTicketId 命中 issue confirmed 工单
  if (target.originalTicketId) {
    for (const issue of issues) {
      if (issue.confirmedTicketIds.includes(target.originalTicketId)) {
        addHit(issue.issueId, 'anchor', 'high', `原工单 ${target.originalTicketId} 已确认属于「${issue.title}」`)
      }
    }
  }

  // ② keywords 通道
  for (const issue of issues) {
    if (hits.get(issue.issueId)?.confidence === 'high') continue
    if (issue.keywords?.length && keywordsMatch(recallText, issue.keywords)) {
      const hitKw = issue.keywords.find((kw) => recallText.includes(String(kw || '').trim()))
      addHit(issue.issueId, 'keywords', 'medium', `命中关键词「${hitKw}」`)
    }
  }

  // ① FTS 通道：画像词检索 → 命中记录反查 confirmed issue
  const searchRange = params.deps?.searchRange || searchRecordsRange
  if (hits.size < issues.length) {
    const queries = deriveFtsQueries(recallText)
    const recordIdToIssue = new Map()
    for (const issue of issues) {
      for (const rid of issue.confirmedRecordIds || []) recordIdToIssue.set(rid, issue.issueId)
    }
    for (const query of queries.slice(0, 2)) {
      // 每条记录最多用 2 个查询词探一次，控成本
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
        if (hits.get(issueId)?.confidence === 'high') continue
        addHit(issueId, 'fts', 'medium', `字面命中：${row.snippet || query}`)
      }
    }
  }

  return [...hits.values()]
}
