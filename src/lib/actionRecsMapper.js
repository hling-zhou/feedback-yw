/**
 * actionRecsMapper.js
 * 引擎 item → ActionRecsResult 映射器
 *
 * 把 actionRecsEngine.cjs 的 runEngine 返回的 summary[].items 映射为
 * 前端可消费的 ActionRecsResult[]，存入快照 planningConclusions.recommendations。
 */

import { createHash } from 'crypto'

/**
 * @typedef {import('../domain/overviewConclusions.js').ActionRecsResult} ActionRecsResult
 * @typedef {import('../domain/overviewConclusions.js').ActionRecsScale} ActionRecsScale
 * @typedef {import('../domain/overviewConclusions.js').ActionRecsProblemSummary} ActionRecsProblemSummary
 * @typedef {import('../domain/overviewConclusions.js').ActionRecsCustomerVoice} ActionRecsCustomerVoice
 * @typedef {import('../domain/overviewConclusions.js').ActionRecsTier} ActionRecsTier
 */

/**
 * @param {string} product
 * @param {string} fam
 * @param {string} sub
 * @returns {string} 稳定 id（product + fam + sub 的短哈希）
 */
function hashId(product, fam, sub) {
  const h = createHash('md5')
  h.update(`${product}::${fam}::${sub}`)
  return 'ar_' + h.digest('hex').slice(0, 12)
}

/**
 * @param {ActionRecsTier} tier
 * @returns {'high' | 'medium' | 'low'} 兼容旧字段 priority
 */
function tierToPriority(tier) {
  if (tier === 'structural') return 'high'
  if (tier === 'change' || tier === 'sharp') return 'high'
  if (tier === 'cross') return 'medium'
  if (tier === 'iteration') return 'medium'
  return 'low'
}

/**
 * 从 item 关联的工单行中提取工单号列表
 * @param {object} item - 引擎 mkItem 产出（含关联的 rows）
 * @param {object[]} [itemRows] - 该 item 关联的工单行（从 engineResult.summary[].rowStatus 或重新从 records 过滤）
 * @returns {string[]}
 */
function collectTicketIds(item, itemRows) {
  // mkItem 不直接保存 rows 引用，需要从外部传入
  // itemRows 是该 fam+sub 分组的工单行
  if (!itemRows || !Array.isArray(itemRows)) return []
  const ids = []
  for (const r of itemRows) {
    const id = String(r['工单号'] || r.ticketId || '').trim()
    if (id) ids.push(id)
  }
  return ids
}

/**
 * 从引擎 summary 条目中找到某 item 对应的工单行
 * 不依赖 rowStatus 索引对齐，直接用 fam+sub 反查 records 中匹配的行。
 * @param {object} productSummary - engineResult.summary 中某个产品的条目
 * @param {object} item - 该产品下的某个 mkItem 产出
 * @param {object[]} records - 全量 records（用于按 fam+sub 过滤）
 * @returns {object[]}
 */
function findItemRows(productSummary, item, records) {
  const p = productSummary.p
  const productRows = records.filter(r => {
    const prod = String(r['产品名称'] || r.product || r.productName || '').replace(/\s/g, '')
    return prod === p
  })
  // 用 fam+sub name 在 record 文本中反查，不依赖 rowStatus 索引对齐
  const famName = item.fam || ''
  const subName = item.sub || ''
  const tax = productSummary.taxUsed
  if (!tax) return []

  // 找到匹配的 family 正则
  const fam = tax.families?.find(f => f.name === famName)
  if (!fam) return []

  const matchingRows = []
  for (const r of productRows) {
    // 用驼峰/中文字段名取值（与引擎的 get() 逻辑一致）
    const reason = String(r['问题原因'] || r.rootCause || r.rootCauseCol || '').trim()
    const pain = String(r['需求痛点'] || r.painPoint || r.problemSummary || '').trim()
    // 检查是否属于这个 family
    const hitR = fam.re.test(reason)
    const hitP = !hitR && fam.re.test(pain)
    if (!hitR && !hitP) continue

    // 检查 sub
    if (!subName || subName === '（其他/通用）' || subName === '（未定位·无根因模板）') {
      // 通配 sub：检查是否有子议题命中，没命中说明是 "其他/通用" 桶
      let subHit = false
      for (const s of (fam.subs || [])) {
        if (s.re.test(reason) || s.re.test(pain)) { subHit = true; break }
      }
      if (!subHit) matchingRows.push(r)
    } else {
      // 精确 sub：检查是否有对应 sub 正则命中
      const sub = (fam.subs || []).find(s => s.name === subName)
      if (sub) {
        if (sub.re.test(reason) || sub.re.test(pain)) matchingRows.push(r)
      } else {
        // autoSplit 产生的 sub：用文本包含匹配
        if (reason.includes(subName) || pain.includes(subName)) matchingRows.push(r)
      }
    }
  }
  return matchingRows
}

/**
 * 把引擎 item 映射为 ActionRecsResult
 * @param {object} item - mkItem 产出
 * @param {object} productSummary - engineResult.summary 中该产品的条目
 * @param {string} dataSourceType - 'complaint_ticket' | 'consultation_ticket'
 * @param {object[]} [records] - 全量 records（用于提取工单号）
 * @returns {ActionRecsResult}
 */
export function toActionRecsResult(item, productSummary, dataSourceType, records) {
  const p = productSummary.p
  const itemRows = records ? findItemRows(productSummary, item, records) : []
  const ticketIds = collectTicketIds(item, itemRows)

  /** @type {ActionRecsScale} */
  const scale = {
    ticketCount: item.n,
    complaintCount: item.c,
    consultationCount: item.q,
    complaintRate: item.cr,
    urgentRate: item.n ? (item.u / item.n) * 100 : 0,
    moMPct: item.mom,
    moMAbs: item.dAbs,
  }

  /** @type {ActionRecsProblemSummary} */
  const problemSummary = {
    pain: item.pain || '',
    root: item.root || '',
  }

  /** @type {ActionRecsCustomerVoice} */
  const customerVoice = {
    verbatim: item.voice ? item.voice.v : '',
    painText: item.pain || '',
    rootText: item.root || '',
  }

  const actionsLayerA = (item.mat || []).map(m => ({
    text: m.s,
    freq: m.c,
  }))

  const id = hashId(p, item.fam, item.sub)

  return {
    // 新引擎字段
    tier: item.tier,
    scale,
    problemSummary,
    recommendation: item.recText || '',
    customerVoice,
    actionsLayerA,
    inventoryStatus: 'none', // P2 由 actionRecsInventory 填充

    // 兼容旧字段
    id,
    stableKey: id,
    priority: tierToPriority(item.tier),
    category: 'product',
    text: `${item.fam} · ${item.sub}`,
    summary: `${item.fam} · ${item.sub}`,
    evidenceTicketIds: ticketIds,
    scope: {
      product: p,
      dataSourceType,
    },
    signalType: item.tier,
    sourceGroup: item.c > 0 && item.q > 0 ? 'cross_source'
      : (item.c > 0 ? 'complaint_only' : 'consultation_only'),
    insufficientEvidence: false,
    evidenceStrength: 'moderate',
    highHarm: !!item.highHarm,
    crossCut: !!item.crossCut,
  }
}

/**
 * 把引擎完整结果映射为 ActionRecsResult[]
 * @param {object} engineResult - runEngine 或 runLoop 返回的 result
 * @param {string} dataSourceType
 * @param {object[]} [records] - 全量 records（用于提取工单号）
 * @returns {ActionRecsResult[]}
 */
export function mapEngineResult(engineResult, dataSourceType, records) {
  const { summary } = engineResult
  const recommendations = []

  for (const productSummary of summary) {
    for (const item of productSummary.items) {
      // 跳过未定位项（数据质量，不进入分层信号）
      if (item.tier === 'unloc') continue
      recommendations.push(toActionRecsResult(item, productSummary, dataSourceType, records))
    }
  }

  return recommendations
}

/**
 * 把引擎 gateReport 映射为快照级 gateReport 摘要
 * @param {object} loopResult - runLoop 返回值
 * @returns {object} ActionRecsGateReport
 */
export function mapGateReport(loopResult) {
  const { gateReport, rounds, escalated } = loopResult
  return {
    rounds,
    passed: gateReport.passed,
    failureCount: gateReport.fails ? gateReport.fails.length : 0,
    escalated,
    failures: gateReport.fails ? gateReport.fails.slice(0, 10).map(f => f.name) : [],
  }
}
