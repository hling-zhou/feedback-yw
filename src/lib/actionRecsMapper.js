/**
 * actionRecsMapper.js
 * 引擎 item → ActionRecsResult 映射器
 *
 * 把 actionRecsEngine.cjs 的 runEngine 返回的 summary[].items 映射为
 * 前端可消费的 ActionRecsResult[]，存入快照 planningConclusions.recommendations。
 */

/**
 * @param {string} product
 * @param {string} fam
 * @param {string} sub
 * @returns {string} 稳定 id（product + fam + sub 的短哈希）
 */
function hashId(product, fam, sub) {
  // djb2 hash — 纯 JS 实现，不依赖 Node crypto，浏览器兼容
  const str = `${product}::${fam}::${sub}`
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    hash = hash & 0xffffffff
  }
  return 'ar_' + (hash >>> 0).toString(16).padStart(8, '0').slice(0, 12)
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
 * 把引擎 item 映射为 ActionRecsResult
 * @param {object} item - mkItem 产出（含 ticketIds）
 * @param {object} productSummary - engineResult.summary 中该产品的条目
 * @param {string} dataSourceType - 'complaint_ticket' | 'consultation_ticket'
 * @returns {ActionRecsResult}
 */
export function toActionRecsResult(item, productSummary, dataSourceType) {
  const p = productSummary.p
  const ticketIds = item.ticketIds || []

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
 * @returns {ActionRecsResult[]}
 */
export function mapEngineResult(engineResult, dataSourceType) {
  const { summary } = engineResult
  const recommendations = []

  for (const productSummary of summary) {
    for (const item of productSummary.items) {
      recommendations.push(toActionRecsResult(item, productSummary, dataSourceType))
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
  const inferFixHint = (name) => {
    if (!name) return ''
    if (name.startsWith('未归类率')) return 'add_coverage'
    if (name.startsWith('待确认率')) return 'restrict_overbroad'
    if (name.startsWith('少数高发')) return 'demote_tier'
    if (name.startsWith('共性项')) return 'recross'
    if (name.startsWith('出处标注')) return 'annotate'
    if (name.startsWith('准确性') && name.includes('排除')) return 'adjust_boundary'
    if (name.startsWith('准确性') && name.includes('误归属')) return 'restrict_term'
    if (name.startsWith('准确性') && name.includes('泛词')) return 'restrict_term'
    return ''
  }
  return {
    rounds,
    passed: gateReport.passed,
    failureCount: gateReport.fails ? gateReport.fails.length : 0,
    escalated,
    failures: gateReport.fails ? gateReport.fails.slice(0, 20).map(f => ({
      name: f.name,
      detail: f.detail || '',
      level: f.level || 'FAIL',
      fixHint: f.fixHint || inferFixHint(f.name),
      evidence: (f.evidence || []).slice(0, 20),
    })) : [],
  }
}
