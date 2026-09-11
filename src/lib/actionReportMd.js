/**
 * 行动建议 Markdown 导出 — recs -> Markdown 文本。
 *
 * @param {import('../domain/overviewConclusions.js').ActionRecsResult[]} recs
 * @param {object|null} [gateReport]
 * @returns {string}
 */
export function exportActionRecsMd(recs, gateReport = null) {
  const lines = []
  const date = new Date().toISOString().slice(0, 10)

  lines.push(`# 行动建议报告`)
  lines.push(``)
  lines.push(`> 生成时间：${date}`)
  lines.push(`> 建议条数：${recs.length}`)
  if (gateReport) {
    lines.push(`> 引擎轮次：${gateReport.rounds} · 门禁：${gateReport.passed ? '通过' : '未通过'}${gateReport.escalated ? ' · 待人工复核' : ''}`)
  }
  lines.push(``)

  const TIER_LABELS = {
    structural: '一、长期结构性',
    change: '二、本月异动',
    sharp: '三、小而锐',
    iteration: '四、常规迭代',
    tail: '五、平稳长尾',
  }

  const TIER_ORDER = ['structural', 'change', 'sharp', 'iteration', 'tail']

  for (const tier of TIER_ORDER) {
    const tierRecs = recs.filter((r) => r.tier === tier)
    if (!tierRecs.length) continue

    lines.push(`---`)
    lines.push(``)
    lines.push(`## ${TIER_LABELS[tier] || tier}（${tierRecs.length}条）`)
    lines.push(``)

    for (let i = 0; i < tierRecs.length; i++) {
      const rec = tierRecs[i]
      const scale = rec.scale || {}
      const ps = rec.problemSummary || {}
      const cv = rec.customerVoice || {}

      lines.push(`### ${i + 1}. ${rec.summary || '—'}`)
      lines.push(``)

      // 定性描述
      if (ps.pain) {
        lines.push(`**[痛点]** ${ps.pain}`)
        lines.push(``)
      }
      if (ps.root) {
        lines.push(`**[根因]** ${ps.root}`)
        lines.push(``)
      }

      // 规模情况
      lines.push(`**规模情况：** ${scale.ticketCount || 0}单 · 投诉率${Number(scale.complaintRate || 0).toFixed(0)}% · 加急率${Number(scale.urgentRate || 0).toFixed(0)}%`)
      if (scale.moMPct !== undefined && scale.moMPct !== 0) {
        lines.push(`环比 ${scale.moMPct > 0 ? '+' : ''}${scale.moMPct}%`)
      }
      lines.push(``)

      // 建议
      if (rec.recommendation) {
        lines.push(`**建议：** ${rec.recommendation}`)
        lines.push(``)
      }

      // 纳入优化
      if (rec.inventoryStatus) {
        const invLabels = { open: '纳入优化·进行中', done: '纳入优化·已完成', stopped: '纳入优化·已停止', none: '未纳入·盲区' }
        lines.push(`**举措状态：** ${invLabels[rec.inventoryStatus] || rec.inventoryStatus}`)
        lines.push(``)
      }

      // 原声
      if (cv.verbatim) {
        lines.push(`> 客户原声："${cv.verbatim}"`)
        lines.push(``)
      }

      lines.push(`---`)
      lines.push(``)
    }
  }

  return lines.join('\n')
}
