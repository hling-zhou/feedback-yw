import * as XLSX from 'xlsx'

const TIER_LABELS = {
  structural: '长期结构性',
  change: '本月异动',
  sharp: '小而锐',
  iteration: '常规迭代池',
  tail: '平稳长尾',
}

const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' }

const INVENTORY_LABELS = {
  open: '纳入·进行中',
  done: '纳入·已完成',
  stopped: '纳入·已暂停',
  none: '未纳入·盲区',
}

/**
 * @param {import('../domain/overviewConclusions.js').ActionRecsResult} rec
 * @param {number} index
 */
export function actionRecsToExportRow(rec, index) {
  const scale = rec.scale || {}
  const ps = rec.problemSummary || {}
  const cv = rec.customerVoice || {}

  return {
    序号: index + 1,
    分层: TIER_LABELS[rec.tier] || rec.tier || '',
    优先级: PRIORITY_LABELS[rec.priority] || rec.priority || '',
    产品: rec.scope?.product || '',
    'L1家族·L2子议题': rec.summary || '',
    '问题概述(需求痛点)': ps.pain || '',
    '问题概述(复核根因)': ps.root || '',
    '工单数(N)': scale.ticketCount ?? '',
    '环比(%)': scale.moMPct != null ? Number(scale.moMPct.toFixed(1)) : '',
    '环比(绝对值)': scale.moMAbs ?? '',
    '投诉数': scale.complaintCount ?? '',
    '咨询数': scale.consultationCount ?? '',
    '投诉率(%)': scale.complaintRate != null ? Number(scale.complaintRate.toFixed(1)) : '',
    '加急率(%)': scale.urgentRate != null ? Number(scale.urgentRate.toFixed(1)) : '',
    '建议': rec.recommendation || '',
    '客户原声': cv.verbatim || '',
    '纳入优化': INVENTORY_LABELS[rec.inventoryStatus] || rec.inventoryStatus || '',
    '候选动作': (rec.actionsLayerA || []).map((a) => `${a.text}(${a.freq})`).join('、'),
    '依据工单号': (rec.evidenceTicketIds || []).slice(0, 50).join('、'),
  }
}

/**
 * @param {import('../domain/overviewConclusions.js').ActionRecsResult[]} recommendations
 * @param {string} [filePrefix]
 */
export function exportActionRecsXlsx(recommendations, filePrefix = '行动建议') {
  const wb = XLSX.utils.book_new()
  const rows = (recommendations || [])
    .map((rec, i) => actionRecsToExportRow(rec, i))

  const sheet = XLSX.utils.json_to_sheet(
    rows.length ? rows : [{ 说明: '暂无行动建议' }],
  )
  XLSX.utils.book_append_sheet(wb, sheet, '行动建议')

  const safePrefix = filePrefix.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40)
  XLSX.writeFile(wb, `${safePrefix}.xlsx`)
}
