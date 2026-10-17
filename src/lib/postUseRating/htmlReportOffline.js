import {
  REPORT_SECTION_APPENDIX,
  REPORT_SECTION_PREVIOUS_VISITS,
  REPORT_SECTION_PRODUCTS,
  REPORT_SECTION_TODO,
} from './htmlReportModel.js'

const TREND_COLORS = ['#4F46E5', '#0D9488', '#DC2626', '#D97706', '#7C3AED', '#0891B2']

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function text(value, fallback = '—') {
  const raw = String(value ?? '').trim()
  return escapeHtml(raw || fallback)
}

function pre(value) {
  return escapeHtml(String(value ?? '')).replace(/\n/g, '<br />')
}

function formatScore(value) {
  if (value == null || value === '') return '—'
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : String(value)
}

function kpiHints(kpis) {
  const lines = [kpis?.vsCompanyLabel, kpis?.momLabel].filter(Boolean)
  if (!lines.length) return ''
  const companyClass = kpis?.vsCompanyTone ? `hint--${kpis.vsCompanyTone}` : ''
  const momClass = kpis?.momTone ? `hint--${kpis.momTone}` : ''
  return `<div class="hints hints--inline">
    ${kpis.vsCompanyLabel ? `<div class="${companyClass}">${escapeHtml(kpis.vsCompanyLabel)}</div>` : ''}
    ${kpis.momLabel ? `<div class="${momClass}">${escapeHtml(kpis.momLabel)}</div>` : ''}
  </div>`
}

function polarityLabel(polarity) {
  return polarity === 'positive' ? '正反馈' : '负反馈'
}

function issueStateLabel(issue) {
  if (issue.severity === 0) return '重点改善'
  if (issue.severity === 1) return '持续观察'
  if (issue.kind === 'change') return '问题增长'
  if (issue.kind === 'action') return '待推动'
  return ''
}

function svgBarChart(rows, { width = 520, height = 200 } = {}) {
  const items = (rows || []).filter((row) => Number(row.value) >= 0)
  if (!items.length) return '<p class="muted">暂无数据</p>'
  const max = Math.max(...items.map((row) => Number(row.value) || 0), 1)
  const pad = { top: 12, right: 12, bottom: 28, left: 36 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const barW = Math.max(18, innerW / items.length - 12)
  const bars = items.map((row, index) => {
    const h = (Number(row.value) / max) * innerH
    const x = pad.left + (innerW / items.length) * index + (innerW / items.length - barW) / 2
    const y = pad.top + innerH - h
    return `<g>
      <title>${escapeHtml(row.label)}：${row.value}</title>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" fill="${row.color || '#4F46E5'}" rx="3" />
      <text x="${(x + barW / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="svg-label">${escapeHtml(row.label)}</text>
    </g>`
  }).join('')
  return `<svg viewBox="0 0 ${width} ${height}" role="img">${bars}</svg>`
}

function svgHBarChart(rows, { width = 640, height, maxValue, reference } = {}) {
  const items = (rows || []).slice(0, 12)
  if (!items.length) return '<p class="muted">暂无数据</p>'
  const rowH = 28
  const h = height || Math.max(120, items.length * rowH + 16)
  const pad = { top: 8, right: 72, bottom: 8, left: 120 }
  const innerW = width - pad.left - pad.right
  const max = maxValue || Math.max(...items.map((row) => Number(row.value) || 0), 1)
  const bars = items.map((row, index) => {
    const y = pad.top + index * rowH
    const w = (Number(row.value) / max) * innerW
    return `<g>
      <title>${escapeHtml(row.label)}：${row.value}${row.hint ? ` · ${row.hint}` : ''}</title>
      <text x="${pad.left - 8}" y="${y + 14}" text-anchor="end" class="svg-label">${escapeHtml(row.label)}</text>
      <rect x="${pad.left}" y="${y + 4}" width="${Math.max(w, 1).toFixed(1)}" height="16" fill="${row.color || '#4F46E5'}" rx="3" />
      <text x="${(pad.left + Math.max(w, 1) + 6).toFixed(1)}" y="${y + 16}" class="svg-label">${escapeHtml(row.value)}</text>
    </g>`
  }).join('')
  const ref = reference == null ? '' : `<line x1="${pad.left + (reference / max) * innerW}" y1="${pad.top}" x2="${pad.left + (reference / max) * innerW}" y2="${h - pad.bottom}" stroke="#F59E0B" stroke-dasharray="4 3" />`
  return `<svg viewBox="0 0 ${width} ${h}" role="img">${ref}${bars}</svg>`
}

function svgLineChart(trend, { width = 520, height = 220, yMax = 10, reference } = {}) {
  const data = trend?.data || []
  const areas = trend?.areas || []
  if (!data.length || !areas.length) return '<p class="muted">暂无趋势</p>'
  const pad = { top: 16, right: 12, bottom: 28, left: 36 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const max = yMax || 10
  const xAt = (index) => pad.left + (data.length === 1 ? innerW / 2 : (index / (data.length - 1)) * innerW)
  const yAt = (value) => pad.top + innerH - (Number(value) / max) * innerH
  const lines = areas.map((area, seriesIndex) => {
    const color = area.stroke || TREND_COLORS[seriesIndex % TREND_COLORS.length]
    const pts = data
      .map((point, index) => {
        const value = point[area.dataKey]
        if (!Number.isFinite(Number(value))) return null
        return `${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`
      })
      .filter(Boolean)
      .join(' ')
    if (!pts.length) return ''
    return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"><title>${escapeHtml(area.name || area.dataKey)}</title></polyline>`
  }).join('')
  const labels = data.map((point, index) => (
    `<text x="${xAt(index).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="svg-label">${escapeHtml(point.date || '')}</text>`
  )).join('')
  const ref = reference == null ? '' : `<line x1="${pad.left}" y1="${yAt(reference).toFixed(1)}" x2="${width - pad.right}" y2="${yAt(reference).toFixed(1)}" stroke="#F59E0B" stroke-dasharray="4 3" />`
  return `<svg viewBox="0 0 ${width} ${height}" role="img">${ref}${lines}${labels}</svg>`
}

function tableHtml(headers, rows) {
  if (!rows?.length) return '<p class="muted">暂无数据</p>'
  const head = `<tr>${headers.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}</tr>`
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${text(cell)}</td>`).join('')}</tr>`).join('')
  return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`
}

function quoteBlock(item) {
  const who = [item.customerName, item.customerCode, item.productName].filter(Boolean).join(' · ') || '未标注客户'
  const score = item.score == null ? '' : `${item.score}分`
  return `<blockquote class="quote quote--${item.polarity === 'positive' ? 'pos' : 'neg'}">
    <div class="quote-meta"><span class="tag ${item.polarity === 'positive' ? 'tag-pos' : 'tag-neg'}">${polarityLabel(item.polarity)}</span> ${text(item.channelLabel)} ${escapeHtml(score)}</div>
    <p>「${text(item.text)}」</p>
    <footer>${escapeHtml(who)}</footer>
  </blockquote>`
}

const OFFLINE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif; color: #1f2937; background: #e8eaed; }
.page { width: min(1300px, calc(100% - 32px)); margin: 24px auto 48px; padding: 28px 32px 48px; background: #fff; box-shadow: 0 8px 24px rgba(15,23,42,.08); }
.banner { font-size: 12px; color: #6b7280; margin: 0 0 16px; }
h1 { font-size: 24px; margin: 0 0 8px; }
h2 { font-size: 18px; margin: 32px 0 12px; }
h3 { font-size: 15px; margin: 0 0 8px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin: 16px 0 20px; }
.kpis--product { grid-template-columns: repeat(5, minmax(0,1fr)); }
.kpi { border: 1px solid #e5e7eb; padding: 12px 14px; }
.kpi .label { font-size: 12px; color: #6b7280; }
.kpi .value { margin-top: 4px; font-size: 22px; font-weight: 650; }
.kpi .hints { margin-top: 6px; font-size: 12px; line-height: 1.45; color: #6b7280; }
.kpi .hints--inline { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 12px; row-gap: 2px; }
.kpi .hint--up { color: #166534; }
.kpi .hint--down { color: #991b1b; }
.kpi.warn { border-color: #f0b4b4; background: #fff7f7; }
.charts { display: flex; flex-direction: column; gap: 12px; margin: 0 0 16px; }
.charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.panel { border: 1px solid #e5e7eb; padding: 12px 14px; }
.panel h3 { font-size: 13px; }
svg { width: 100%; height: auto; }
.svg-label { font-size: 11px; fill: #6b7280; }
.voice { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 0 16px; }
.quote { margin: 0 0 10px; padding: 10px 12px; border: 1px solid #e5e7eb; }
.quote--pos { border-left: 3px solid #3d9a5f; background: #f6fbf7; }
.quote--neg { border-left: 3px solid #c45b5b; background: #fdf7f7; }
.quote p { margin: 6px 0; font-size: 13px; line-height: 1.6; }
.quote footer, .quote-meta { font-size: 12px; color: #6b7280; }
.tag { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 12px; }
.tag-pos { background: #dcfce7; color: #166534; }
.tag-neg { background: #fee2e2; color: #991b1b; }
.issue { border-top: 1px solid #e5e7eb; padding: 18px 0; }
.evidence { margin: 10px 0 12px; padding: 10px 12px; background: #f9fafb; border: 1px solid #eef0f3; font-size: 13px; line-height: 1.65; }
.narrative { white-space: pre-wrap; line-height: 1.7; }
.muted { color: #9ca3af; font-size: 13px; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
th { background: #f9fafb; }
details { margin: 8px 0; border: 1px solid #e5e7eb; padding: 8px 12px; }
summary { cursor: pointer; font-weight: 600; }
@media (max-width: 900px) {
  .kpis, .charts-grid, .voice { grid-template-columns: 1fr; }
}
`

function issueHtml(issue, narrative, index) {
  const evidence = issue.evidence || {}
  const quotes = evidence.quotes || []
  const options = evidence.options || []
  const positiveQuotes = evidence.positiveQuotes || []
  const conclusion = narrative?.conclusion || issue.conclusion || issue.conclusionDraft || ''
  const action = narrative?.action || issue.action || issue.actionDraft || ''
  const quoteHtml = quotes.length
    ? quotes.map((item) => `<div>${quoteBlock(item)}</div>`).join('')
    : options.length
      ? options.map((item) => `<div class="quote quote--neg"><span class="tag tag-neg">负反馈</span> 反馈选项：${text(item.text)}</div>`).join('')
      : '<p class="muted">本条暂无有效负向原话</p>'
  const praiseHtml = positiveQuotes.length
    ? `<div><strong>同产品正反馈</strong>${positiveQuotes.map(quoteBlock).join('')}</div>`
    : ''
  return `<section class="issue">
    <h3>${index + 1}. ${text(issue.productName, '未标注产品')} ${issueStateLabel(issue) ? `<span class="tag">${escapeHtml(issueStateLabel(issue))}</span>` : ''}</h3>
    <p><strong>结论</strong></p>
    <p class="narrative">${pre(conclusion)}</p>
    <div class="evidence">
      <div>均分 ${escapeHtml(formatScore(evidence.avgScore))} · 样本 ${evidence.sampleSize || 0} · 非10分 ${evidence.nonTenCount || 0}${evidence.changeLabel ? ` · 问题变化 ${text(evidence.changeIssue)} ${text(evidence.changeLabel)}` : ''}</div>
      ${quoteHtml}
      ${praiseHtml}
    </div>
    <p><strong>建议动作</strong></p>
    <p class="narrative">${pre(action)}</p>
  </section>`
}

function productMetricCard(label, value, comparison) {
  const hint = comparison?.label
    ? `<div class="hints"><div class="hint hint--${escapeHtml(comparison.tone || 'na')}">${escapeHtml(comparison.label)}</div></div>`
    : ''
  return `<div class="kpi"><div class="label">${escapeHtml(label)}</div><div class="value">${value}</div>${hint}</div>`
}

function productCardHtml(card, preview, issueNarratives) {
  const issue = card.issue
  const narrative = issue ? issueNarratives[issue.key] || {} : {}
  const distribution = (preview.scoreDistributionTable || []).filter((row) => row.productName === card.productName)
  const scenes = (preview.sceneJourneys || []).filter((row) => row.productName === card.productName)
  const evidence = issue ? issueHtml(issue, narrative, 0) : '<p class="muted">本产品本月没有单列问题条。</p>'
  return `<section class="issue">
    <h3>${text(card.productName)}</h3>
    <div class="kpis kpis--product">
      ${productMetricCard('产品体验得分', escapeHtml(formatScore(card.experienceScore)), card.comparisons?.experienceScore)}
      ${productMetricCard('投诉回访满意度', card.satisfactionRate == null ? '—' : `${escapeHtml(String(card.satisfactionRate))}%`, card.comparisons?.satisfactionRate)}
      ${productMetricCard('均分（三渠道）', escapeHtml(formatScore(card.mixedAvg)), card.comparisons?.mixedAvg)}
      ${productMetricCard('样本数（三渠道）', escapeHtml(String(card.mixedSample ?? 0)), card.comparisons?.mixedSample)}
      ${productMetricCard('3 分以下样本数', escapeHtml(String(card.lowScoreCount ?? 0)), card.comparisons?.lowScoreCount)}
    </div>
    <h4>得分分布</h4>
    ${tableHtml(['样本', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1'], distribution.map((row) => [row.sampleSize, row['10'], row['9'], row['8'], row['7'], row['6'], row['5'], row['4'], row['3'], row['2'], row['1']]))}
    <h4>场景与旅程</h4>
    ${tableHtml(['场景', '旅程', '样本', '均分'], scenes.map((row) => [row.originalScene, row.journey, row.sampleSize, row.avgScore]))}
    ${evidence}
    <h4>本月客服部回访</h4>
    ${(card.visitNarratives || []).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
    <h4>得分趋势</h4>
    ${svgLineChart(card.scoreTrend, { yMax: 10, reference: 9 })}
  </section>`
}

/**
 * 生成可双击打开的自包含离线 HTML（无外部脚本/样式，不依赖登录）。
 * @param {{
 *   model: object
 *   judgment?: string
 *   todoNote?: string
 *   issueNarratives?: Record<string, { conclusion: string, action: string }>
 *   hiddenSectionIds?: string[]
 *   exportedAt?: string
 * }} input
 */
export function buildOfflineMonthlyReportHtml(input) {
  const model = input?.model
  if (!model) throw new Error('没有可导出的月报')
  const hidden = new Set(input.hiddenSectionIds || [])
  const judgment = input.judgment ?? model.judgment ?? model.judgmentDraft ?? ''
  const todoNote = input.todoNote ?? model.todoNote ?? ''
  const issueNarratives = input.issueNarratives || {}
  const exportedAt = input.exportedAt || new Date().toISOString()
  const copy = model.copy || {}
  const kpis = model.kpis || {}
  const charts = model.charts || {}
  const preview = model.preview || {}

  const statusTrend = charts.statusTrend || { data: [], areas: [] }
  const scoreStatus = {
    data: statusTrend.data || [],
    areas: (statusTrend.areas || []).filter((area) => area.yAxisId !== 'rate'),
  }
  const rateStatus = {
    data: statusTrend.data || [],
    areas: (statusTrend.areas || []).filter((area) => area.yAxisId === 'rate'),
  }
  const productsHtml = hidden.has(REPORT_SECTION_PRODUCTS)
    ? ''
    : `<h2>分产品情况</h2>${(model.productCards || []).map((card) => productCardHtml(card, preview, issueNarratives)).join('') || '<p class="muted">当月暂无产品评分。</p>'}
      <h3>重点产品体验均分趋势</h3>${svgLineChart(charts.scoreTrend, { yMax: 10, reference: 9 })}
      <h3>重点产品投诉回访满意度趋势</h3>${svgLineChart(charts.satisfactionTrend, { yMax: 100, reference: 88 })}`

  const todo = model.todo || {}
  const todoHtml = hidden.has(REPORT_SECTION_TODO)
    ? ''
    : `<h2>待办事情及进展</h2>
      <div class="kpis">
        <div class="kpi"><div class="label">${escapeHtml(copy.todoProposed || '本月提出')}</div><div class="value">${todo.proposedCount || 0}</div></div>
        <div class="kpi"><div class="label">${escapeHtml(copy.todoClosed || '本月关闭')}</div><div class="value">${todo.closedCount || 0}</div></div>
        <div class="kpi ${todo.notRecoveredCount ? 'warn' : ''}"><div class="label">已完成未恢复</div><div class="value">${todo.notRecoveredCount || 0}</div></div>
        <div class="kpi"><div class="label">建议回访/溯源</div><div class="value">${todo.callbackCount || 0}</div></div>
      </div>
      ${(todo.proposed || []).map((item) => `<p>提出：${text(item.productName)} · ${text(item.content)}</p>`).join('')}
      ${(todo.notRecovered || []).map((item) => `<p>已完成未恢复：${text(item.productName)} · ${text(item.content)}</p>`).join('')}
      ${(todo.callbackHighlights || []).length
        ? `<ol>${(todo.callbackHighlights || []).map((item) => `<li>${text(item.reason)}</li>`).join('')}</ol>`
        : ''}
      ${todoNote ? `<p class="narrative">${pre(todoNote)}</p>` : ''}`

  const visitRows = (model.previousVisits || []).map((row) => {
    const saved = input.visitSupplements?.[row.id] || {}
    return {
      ...row,
      visitResult: saved.visitResult ?? row.visitResult,
      internalConclusion: saved.internalConclusion ?? row.internalConclusion,
      remark: saved.remark ?? row.remark,
    }
  })
  const previousVisitsHtml = model.showPreviousVisits === false || hidden.has(REPORT_SECTION_PREVIOUS_VISITS)
    ? ''
    : `<h2>上期客服部回访结果补充</h2>${visitRows.length ? tableHtml(
      ['客户', '客服部回访记录', '回访结果内部评估/回应', '备注'],
      visitRows.map((row) => [row.customerName, row.visitResult, row.internalConclusion, row.remark]),
    ) : '<p class="muted">上期无客服部回访记录。</p>'}`

  const appendixHidden = hidden.has(REPORT_SECTION_APPENDIX)
  const appendixHtml = appendixHidden
    ? ''
    : `<h2>附录</h2>
      <details><summary>整体得分表</summary>${tableHtml(
        ['产品', '样本量', '均分', '投诉回访10分满意比'],
        (preview.monthlyScoreTable || []).map((row) => [row.productName, row.sampleSize, row.avgScore, row.callbackTenPointRate]),
      )}</details>
      <details><summary>评分分布</summary>${tableHtml(
        ['产品', '样本', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
        (preview.scoreDistributionTable || []).map((row) => [row.productName, row.sampleSize, row['10'], row['9'], row['8'], row['7'], row['6'], row['5'], row['4'], row['3'], row['2'], row['1']]),
      )}</details>
      <details><summary>有效客户原话登记</summary>${tableHtml(
        ['渠道', '正负', '类型', '产品', '得分', '客户', '时间', '原文'],
        (model.quoteRegistry || []).map((row) => [
          row.channelLabel,
          polarityLabel(row.polarity),
          row.kind === 'quote' ? '客户原话' : '反馈选项',
          row.productName,
          row.score,
          [row.customerName, row.customerCode].filter(Boolean).join(' / '),
          row.answeredAt,
          row.text,
        ]),
      )}</details>`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${text(model.title, `用后即评月报（${model.reportMonth || ''}）`)}</title>
  <style>${OFFLINE_CSS}</style>
</head>
<body>
  <article class="page">
    <p class="banner">离线快照 · 导出于 ${escapeHtml(exportedAt)} · 不依赖系统登录，图表为导出时锁定画面</p>
    <h1>${text(model.title)}</h1>
    <h2>${escapeHtml(copy.overviewTitle || '本月概述')}</h2>
    <p class="narrative">${pre(judgment)}</p>
    <div class="kpis">
      <div class="kpi"><div class="label">涉及产品数</div><div class="value">${kpis.productCount ?? 0}</div><div class="hints">总样本量 ${kpis.totalSample ?? 0}</div></div>
      <div class="kpi ${Number(kpis.avgScore) < 9 ? 'warn' : ''}"><div class="label">云网均分（三渠道）</div><div class="value">${escapeHtml(formatScore(kpis.avgScore))}</div>${kpiHints(kpis)}</div>
      <div class="kpi ${kpis.belowNineCount ? 'warn' : ''}"><div class="label">9 分以下产品数</div><div class="value">${kpis.belowNineCount ?? 0}</div><div class="hints">${escapeHtml((kpis.belowNineNames || []).join('、') || '无')}</div></div>
      <div class="kpi ${kpis.callbackUnqualifiedCount ? 'warn' : ''}"><div class="label">投诉回访不达标产品数</div><div class="value">${kpis.callbackUnqualifiedCount ?? 0}</div><div class="hints">${escapeHtml((kpis.callbackUnqualifiedNames || []).join('、') || '无')}</div></div>
    </div>
    <div class="charts">
      <div class="panel"><h3>均分趋势（关注线 9）</h3>${svgLineChart(scoreStatus, { yMax: 10, reference: 9 })}</div>
      <div class="panel"><h3>投诉回访满意度（达标线 88%）</h3>${svgLineChart(rateStatus, { yMax: 100, reference: 88 })}</div>
    </div>
    ${productsHtml}
    ${todoHtml}
    ${previousVisitsHtml}
    ${appendixHtml}
  </article>
</body>
</html>`
}

export function offlineMonthlyReportFilename(reportMonth, prefix = '用后即评月报') {
  return `${prefix}-${reportMonth || 'unknown'}.html`
}

/**
 * @param {string} html
 * @param {string} filename
 */
export function downloadOfflineMonthlyReportHtml(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
