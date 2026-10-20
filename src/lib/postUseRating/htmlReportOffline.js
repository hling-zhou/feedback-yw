import {
  REPORT_SECTION_APPENDIX,
  REPORT_SECTION_PREVIOUS_VISITS,
  REPORT_SECTION_PRODUCTS,
  REPORT_SECTION_TODO,
} from './htmlReportModel.js'
import { toJourneyChartRows, withPostUseTrendDomains } from './insights.js'
import { POST_USE_SATISFACTION_BASELINE, POST_USE_SCORE_BASELINE } from './metrics.js'

const TREND_COLORS = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2']

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;')
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

function formatPercent(value) {
  if (value == null || value === '') return '—'
  const num = Number(value)
  return Number.isFinite(num) ? `${num}%` : String(value)
}

function kpiHints(kpis) {
  const lines = [kpis?.vsCompanyLabel, kpis?.momLabel].filter(Boolean)
  if (!lines.length) return ''
  const companyClass = kpis?.vsCompanyTone ? `hint--${kpis.vsCompanyTone}` : ''
  const momClass = kpis?.momTone ? `hint--${kpis.momTone}` : ''
  return `<div class="post-use-html-report-kpi-hints post-use-html-report-kpi-hints--inline">
    ${kpis.vsCompanyLabel ? `<div class="${companyClass}">${escapeHtml(kpis.vsCompanyLabel)}</div>` : ''}
    ${kpis.momLabel ? `<div class="${momClass}">${escapeHtml(kpis.momLabel)}</div>` : ''}
  </div>`
}

function polarityLabel(polarity) {
  return polarity === 'positive' ? '正反馈' : '负反馈'
}

function toneClass(tone = 'na') {
  if (tone === 'up') return 'hint--up'
  if (tone === 'down') return 'hint--down'
  return `hint--${escapeHtml(tone)}`
}

function readonlyBlock(value, placeholder = '—') {
  const raw = String(value ?? '').trim()
  return `<div class="readonly-block">${raw ? pre(raw) : escapeHtml(placeholder)}</div>`
}

function reviewAlertHtml(reviewItems) {
  if (!reviewItems?.length) return ''
  return `<div class="report-alert report-alert--info">
    <div class="report-alert__title">历史复核提示（只读）</div>
    <ul>
      ${reviewItems.map((item) => `<li>${escapeHtml(item.sectionLabel)}：${escapeHtml(item.title)}。${escapeHtml(item.recommendation)}</li>`).join('')}
    </ul>
  </div>`
}

function warningAlertHtml(message) {
  if (!message) return ''
  return `<div class="report-alert report-alert--warn"><div class="report-alert__title">${escapeHtml(message)}</div></div>`
}

function finiteChartValue(value) {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

// 各图设计宽度对齐线上 App 同位置的 recharts 实际渲染宽度（1300px 容器实测：
// 概述状态面板内宽 1224、半宽趋势面板内宽 592、产品详情列 996、附录折叠内容 1224），
// 配合固定像素渲染保证离线导出与线上 1:1，小窗口下 max-width:100% 等比缩回。
const CHART_WIDTHS = {
  statusOverview: 1224,
  productTrend: 996,
  productJourney: 996,
  appendixJourney: 1224,
}

function svgOpen(width, height) {
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" overflow="hidden" role="img">`
}

function roundTick(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100) / 100
}

function buildTicks(min, max, kind) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [roundTick(min)]
  if (kind === 'rate') {
    const start = Math.floor(min / 10) * 10
    const ticks = []
    for (let value = start; value <= max + 0.001; value += 10) ticks.push(value)
    return ticks.length ? ticks : [roundTick(min), roundTick(max)]
  }
  const span = max - min
  const roughStep = span / 4
  const step = roughStep <= 0.5 ? 0.5 : roughStep <= 1 ? 1 : roughStep <= 2 ? 2 : Math.ceil(roughStep)
  const ticks = []
  for (let value = min; value <= max + 0.0001; value += step) {
    ticks.push(roundTick(value))
  }
  if (ticks[ticks.length - 1] !== roundTick(max)) ticks.push(roundTick(max))
  return [...new Set(ticks)]
}

function chartLegend(areas) {
  if (!areas?.length) return ''
  return `<div class="report-visual-legend">
    ${areas.map((area, index) => `<span class="legend-item"><span class="legend-swatch" style="background:${escapeAttr(area.stroke || TREND_COLORS[index % TREND_COLORS.length])}"></span>${escapeHtml(area.name || area.dataKey)}</span>`).join('')}
  </div>`
}

function renderTrendAxes({
  width,
  height,
  pad,
  leftTicks,
  rightTicks,
  leftYAt,
  rightYAt,
  hasRightAxis,
}) {
  const grid = leftTicks.map((tick) => {
    const y = leftYAt(tick).toFixed(1)
    return `<g>
      <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#E5E7EB" stroke-dasharray="3 3" />
      <text x="${pad.left - 8}" y="${Number(y) + 4}" text-anchor="end" class="svg-label">${escapeHtml(String(tick))}</text>
    </g>`
  }).join('')
  const right = hasRightAxis
    ? rightTicks.map((tick) => {
      const y = rightYAt(tick).toFixed(1)
      return `<text x="${width - pad.right + 8}" y="${Number(y) + 4}" text-anchor="start" class="svg-label">${escapeHtml(String(tick))}%</text>`
    }).join('')
    : ''
  return `${grid}${right}`
}

function renderReferenceLines({
  width,
  pad,
  referenceLines,
  scoreYAt,
  rateYAt,
}) {
  return (referenceLines || []).map((line, index) => {
    const isRate = line?.yAxisId === 'rate'
    const yAt = isRate ? rateYAt : scoreYAt
    if (!yAt || !Number.isFinite(Number(line?.y))) return ''
    const y = yAt(Number(line.y))
    if (!Number.isFinite(y)) return ''
    const stroke = line.stroke || (isRate ? '#059669' : '#F59E0B')
    const labelX = index % 2 === 0 ? pad.left + 4 : width - pad.right - 4
    const anchor = index % 2 === 0 ? 'start' : 'end'
    return `<g>
      <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="${stroke}" stroke-dasharray="${escapeAttr(line.strokeDasharray || '6 4')}" />
      <text x="${labelX}" y="${(y - 6).toFixed(1)}" text-anchor="${anchor}" class="svg-ref-label" fill="${stroke}">${escapeHtml(line.label || String(line.y))}</text>
    </g>`
  }).join('')
}

function renderTrendSeries({
  data,
  areas,
  xAt,
  yAtForArea,
}) {
  return areas.map((area, index) => {
    const color = area.stroke || TREND_COLORS[index % TREND_COLORS.length]
    const segments = []
    let current = []
    data.forEach((point, pointIndex) => {
      const value = finiteChartValue(point[area.dataKey])
      if (value == null) {
        if (current.length) {
          segments.push(current)
          current = []
        }
        return
      }
      current.push(`${xAt(pointIndex).toFixed(1)},${yAtForArea(area, value).toFixed(1)}`)
    })
    if (current.length) segments.push(current)
    const lines = segments
      .filter((points) => points.length > 1)
      .map((points) => `<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${points.join(' ')}" />`)
      .join('')
    const dots = data.map((point, pointIndex) => {
      const value = finiteChartValue(point[area.dataKey])
      if (value == null) return ''
      const suffix = area.yAxisId === 'rate' ? '%' : ''
      return `<g class="chart-hit" tabindex="0" data-tooltip="${escapeAttr(`${point.date || ''} ${area.name || area.dataKey} ${value}${suffix}`)}">
        <circle cx="${xAt(pointIndex).toFixed(1)}" cy="${yAtForArea(area, value).toFixed(1)}" r="9" fill="transparent" />
        <circle cx="${xAt(pointIndex).toFixed(1)}" cy="${yAtForArea(area, value).toFixed(1)}" r="3.5" fill="${color}" />
      </g>`
    }).join('')
    return `${lines}${dots}`
  }).join('')
}

function svgTrendChart(chart, {
  kind = 'score',
  width = 760,
  height = 240,
  referenceLines = [],
} = {}) {
  const resolved = withPostUseTrendDomains(chart || { data: [], areas: [] }, { kind }) || chart || { data: [], areas: [] }
  const data = resolved?.data || []
  const areas = resolved?.areas || []
  if (!data.length || !areas.length) return '<div class="report-chart-empty">暂无趋势数据</div>'

  const scoreAreas = kind === 'combined'
    ? areas.filter((area) => area.yAxisId !== 'rate')
    : areas
  const rateAreas = kind === 'combined'
    ? areas.filter((area) => area.yAxisId === 'rate')
    : []

  const scoreDomain = scoreAreas[0]?.domain || resolved.domain || [0, 10]
  const rateDomain = rateAreas[0]?.domain || [0, 100]
  const [scoreMin, scoreMax] = scoreDomain
  const [rateMin, rateMax] = rateDomain
  const dualAxis = kind === 'combined' && rateAreas.length > 0 && scoreAreas.length > 0

  const pad = { top: 16, right: dualAxis ? 54 : 16, bottom: 34, left: 40 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const scoreSpan = Math.max(scoreMax - scoreMin, 0.01)
  const rateSpan = Math.max(rateMax - rateMin, 0.01)
  const xAt = (index) => pad.left + (data.length === 1 ? innerW / 2 : (index / (data.length - 1)) * innerW)
  const scoreYAt = (value) => pad.top + innerH - ((Number(value) - scoreMin) / scoreSpan) * innerH
  const rateYAt = (value) => pad.top + innerH - ((Number(value) - rateMin) / rateSpan) * innerH
  const yAtForArea = (area, value) => (dualAxis && area.yAxisId === 'rate' ? rateYAt(value) : scoreYAt(value))

  const scoreTicks = buildTicks(scoreMin, scoreMax, 'score')
  const rateTicks = dualAxis ? buildTicks(rateMin, rateMax, 'rate') : []
  const axes = renderTrendAxes({
    width,
    height,
    pad,
    leftTicks: scoreTicks,
    rightTicks: rateTicks,
    leftYAt: scoreYAt,
    rightYAt: rateYAt,
    hasRightAxis: dualAxis,
  })
  const refs = renderReferenceLines({
    width,
    pad,
    referenceLines,
    scoreYAt,
    rateYAt: dualAxis ? rateYAt : null,
  })
  const series = renderTrendSeries({ data, areas, xAt, yAtForArea })
  const labels = data.map((point, index) => (
    `<text x="${xAt(index).toFixed(1)}" y="${height - 10}" text-anchor="middle" class="svg-label">${escapeHtml(point.date || '')}</text>`
  )).join('')
  const axisRails = [
    `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#CBD5E1" />`,
    `<line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#CBD5E1" />`,
    dualAxis ? `<line x1="${width - pad.right}" y1="${pad.top}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#CBD5E1" />` : '',
  ].join('')
  return `<div class="report-chart-shell">
    ${svgOpen(width, height)}${axes}${refs}${axisRails}${series}${labels}</svg>
    ${chartLegend(areas)}
  </div>`
}

function svgJourneyCombo(rows, { width = CHART_WIDTHS.productJourney, height = 260, productName = '' } = {}) {
  const items = toJourneyChartRows(rows, { productName })
  if (!items.some((row) => row.sampleSize > 0)) return '<div class="report-chart-empty">暂无用户旅程分布</div>'
  const maxSample = Math.max(...items.map((row) => row.sampleSize), 1)
  const scores = items.map((row) => row.avgScore).filter((value) => Number.isFinite(value))
  const scoreMin = scores.length ? Math.max(0, Math.floor(Math.min(...scores) - 1)) : 0
  const scoreMax = 10
  const scoreSpan = Math.max(scoreMax - scoreMin, 0.01)
  const pad = { top: 16, right: 42, bottom: 30, left: 40 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const barW = Math.max(20, innerW / items.length - 12)
  const xAt = (index) => pad.left + (innerW / items.length) * index + innerW / items.length / 2
  const ySample = (value) => pad.top + innerH - (Number(value) / maxSample) * innerH
  const yScore = (value) => pad.top + innerH - ((Number(value) - scoreMin) / scoreSpan) * innerH
  const bars = items.map((row, index) => {
    const h = (row.sampleSize / maxSample) * innerH
    const x = xAt(index) - barW / 2
    const y = pad.top + innerH - h
    if (!row.sampleSize) return ''
    return `<g class="chart-hit" tabindex="0" data-tooltip="${escapeAttr(`${row.journey} 样本 ${row.sampleSize}`)}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" fill="#D1D5DB" rx="3" />
    </g>`
  }).join('')
  // 与线上 PostUseJourneyMap（连接空值）保持一致：跨空槽连点，避免稀疏旅程下折线整体消失。
  const points = items
    .map((row, index) => (Number.isFinite(row.avgScore)
      ? `${xAt(index).toFixed(1)},${yScore(row.avgScore).toFixed(1)}`
      : null))
    .filter(Boolean)
  const lines = points.length > 1
    ? `<polyline fill="none" stroke="#0F766E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points.join(' ')}" />`
    : ''
  const dots = items.map((row, index) => {
    if (!Number.isFinite(row.avgScore)) return ''
    return `<g class="chart-hit" tabindex="0" data-tooltip="${escapeAttr(`${row.journey} 均分 ${row.avgScore}`)}">
      <circle cx="${xAt(index).toFixed(1)}" cy="${yScore(row.avgScore).toFixed(1)}" r="4" fill="#0F766E" stroke="#fff" stroke-width="1" />
    </g>`
  }).join('')
  const labels = items.map((row, index) => (
    `<text x="${xAt(index).toFixed(1)}" y="${height - 10}" text-anchor="middle" class="svg-label">${escapeHtml(row.journey)}</text>`
  )).join('')
  const refY = POST_USE_SCORE_BASELINE >= scoreMin && POST_USE_SCORE_BASELINE <= scoreMax
    ? `<g style="pointer-events: none;">
      <line x1="${pad.left}" y1="${yScore(POST_USE_SCORE_BASELINE).toFixed(1)}" x2="${width - pad.right}" y2="${yScore(POST_USE_SCORE_BASELINE).toFixed(1)}" stroke="#F59E0B" stroke-dasharray="6 4" />
      <text x="${width - pad.right}" y="${(yScore(POST_USE_SCORE_BASELINE) - 6).toFixed(1)}" text-anchor="end" class="svg-ref-label">关注线 9</text>
    </g>`
    : ''
  return `<div class="report-chart-shell">
    ${svgOpen(width, height)}
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#CBD5E1" />
      <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#CBD5E1" />
      ${bars}
      ${lines}
      ${dots}
      ${refY}
      ${labels}
      <text x="${width - 4}" y="${pad.top + 8}" text-anchor="end" class="svg-label">${scoreMax}</text>
      <text x="${width - 4}" y="${height - pad.bottom}" text-anchor="end" class="svg-label">${scoreMin}</text>
    </svg>
    <div class="report-visual-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:#D1D5DB"></span>样本量</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#0F766E"></span>均分</span>
    </div>
  </div>`
}

function tableHtml(headers, rows, emptyText = '暂无数据') {
  if (!rows?.length) return `<div class="report-table-empty">${escapeHtml(emptyText)}</div>`
  const head = `<tr>${headers.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}</tr>`
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell == null || cell === '' ? '—' : String(cell)}</td>`).join('')}</tr>`).join('')
  return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`
}

function scoreMeterHtml(avgScore, sampleSize, nonTenCount) {
  const score = Number(avgScore)
  const ratio = Number.isFinite(score) ? Math.max(0, Math.min(100, (score / 10) * 100)) : 0
  const nonTenRate = sampleSize ? Math.round(((nonTenCount || 0) / sampleSize) * 1000) / 10 : 0
  return `<div class="report-score-meter">
    <div class="report-score-meter__track">
      <span class="report-score-meter__fill" style="width:${ratio}%"></span>
      <span class="report-score-meter__mark" style="left:90%"></span>
    </div>
    <div class="report-score-meter__caption">
      均分 ${escapeHtml(formatScore(avgScore))} / 10 · 样本 ${sampleSize || 0} · 非10分 ${nonTenCount || 0}${sampleSize ? `（${nonTenRate}%）` : ''}
    </div>
  </div>`
}

function quoteLineHtml(item, polarity = item?.polarity || 'negative') {
  const who = [item?.customerName, item?.customerCode].filter(Boolean).join(' / ') || '未标注客户'
  const score = item?.score == null ? '' : ` · ${item.score}分`
  return `<div class="post-use-html-report-quote"><span class="quote-pill quote-pill--${polarity === 'positive' ? 'positive' : 'negative'}">${polarityLabel(polarity)}</span>「${text(item?.text)}」— ${escapeHtml(who)}${escapeHtml(score)}${item?.channelLabel ? ` · ${escapeHtml(item.channelLabel)}` : ''}</div>`
}

const PRODUCT_SECTION_GROUPS = [
  { key: 'overview', label: '评分概览' },
  { key: 'negative', label: '负反馈详情及建议举措' },
  { key: 'positive', label: '正反馈' },
]

/** 单产品详情内的随屏导航条（与线上 ProductSectionNav 同构，只读锚点跳转） */
function productNavHtml(productName) {
  const anchorBase = `p-${productName}`
  return `<nav class="report-product-nav" aria-label="${escapeAttr(productName)}模块导航">
    ${PRODUCT_SECTION_GROUPS.map((group) => `<a href="#${escapeAttr(anchorBase)}-${group.key}" class="report-product-nav__item" data-nav-group="${group.key}">${escapeHtml(group.label)}</a>`).join('')}
  </nav>`
}

function negativeQuotesHtml(evidence) {
  const quotes = evidence.quotes || []
  const options = evidence.options || []
  if (quotes.length) return quotes.map((item) => quoteLineHtml(item, item.polarity)).join('')
  if (options.length) {
    return options.map((item) => `<div class="post-use-html-report-quote"><span class="quote-pill quote-pill--negative">负反馈</span>反馈选项：${text(item.text)}${item.customerName ? `（${escapeHtml(item.customerName)}${item.score == null ? '' : ` · ${escapeHtml(String(item.score))}分`}）` : ''}</div>`).join('')
  }
  return '<div class="post-use-html-report-quote">本条暂无有效负向原话</div>'
}

function productMetricCard(label, value, comparison) {
  const hint = comparison?.label
    ? `<div class="post-use-html-report-kpi-hints"><div class="${toneClass(comparison.tone)}">${escapeHtml(comparison.label)}</div></div>`
    : ''
  return `<div class="post-use-html-report-kpi"><div class="label">${escapeHtml(label)}</div><div class="value">${value}</div>${hint}</div>`
}

function productCardHtml(card, preview, issueNarratives, active = false) {
  const issue = card.issue
  const narrative = issue ? issueNarratives[issue.key] || {} : {}
  const evidence = issue?.evidence || {}
  const distribution = (preview.scoreDistributionTable || []).filter((row) => row.productName === card.productName)
  const journeys = (preview.journeyDistribution || []).filter((row) => row.productName === card.productName)
  const scoreTrend = svgTrendChart(card.scoreTrend, {
    kind: 'score',
    width: CHART_WIDTHS.productTrend,
    height: 240,
    referenceLines: [{ y: POST_USE_SCORE_BASELINE, label: '关注线 9' }],
  })
  const anchorBase = `p-${card.productName}`
  const conclusion = narrative.conclusion ?? issue?.conclusion ?? issue?.conclusionDraft ?? ''
  const action = narrative.action ?? issue?.action ?? issue?.actionDraft ?? ''
  const positiveQuotes = evidence.positiveQuotes || []
  return `<section class="report-product-detail${active ? ' is-active' : ''}" data-product-panel="${escapeAttr(card.productName)}">
    <h3>${text(card.productName)}</h3>
    ${productNavHtml(card.productName)}
    <div id="${escapeAttr(anchorBase)}-overview" class="report-product-group report-product-group--overview" data-nav-group="overview">
      <div class="report-group-title">评分概览</div>
      ${issue ? `<div class="report-group-subtitle">结论</div>${readonlyBlock(conclusion)}` : ''}
      <div class="post-use-html-report-kpis post-use-html-report-kpis--product">
        ${productMetricCard('产品体验得分', escapeHtml(formatScore(card.experienceScore)), card.comparisons?.experienceScore)}
        ${productMetricCard('投诉回访满意度', escapeHtml(formatPercent(card.satisfactionRate)), card.comparisons?.satisfactionRate)}
        ${productMetricCard('均分（三渠道）', escapeHtml(formatScore(card.mixedAvg)), card.comparisons?.mixedAvg)}
        ${productMetricCard('样本数（三渠道）', escapeHtml(String(card.mixedSample ?? 0)), card.comparisons?.mixedSample)}
        ${productMetricCard('3 分以下样本数', escapeHtml(String(card.lowScoreCount ?? 0)), card.comparisons?.lowScoreCount)}
      </div>
      <div class="report-group-subtitle">得分分布</div>
      ${tableHtml(
        ['样本', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
        distribution.map((row) => [row.sampleSize, row['10'], row['9'], row['8'], row['7'], row['6'], row['5'], row['4'], row['3'], row['2'], row['1']].map((cell) => escapeHtml(String(cell ?? '—')))),
        '暂无得分分布',
      )}
      <div class="report-group-subtitle">用户旅程分布</div>
      ${svgJourneyCombo(journeys, { productName: card.productName })}
      <div class="report-group-subtitle">得分趋势</div>
      ${scoreTrend}
    </div>
    <div id="${escapeAttr(anchorBase)}-negative" class="report-product-group report-product-group--negative" data-nav-group="negative">
      <div class="report-group-title">负反馈详情及建议举措</div>
      ${issue ? `
        ${scoreMeterHtml(evidence.avgScore, evidence.sampleSize, evidence.nonTenCount)}
        ${evidence.changeLabel ? `<div class="report-evidence-hint">问题变化 ${text(evidence.changeIssue)} ${text(evidence.changeLabel)}</div>` : ''}
        ${negativeQuotesHtml(evidence)}` : '<p class="report-group-empty">本产品本月没有单列问题条。</p>'}
      <div class="report-group-subtitle">客服部回访记录</div>
      <div class="post-use-html-report-evidence">
        ${(card.visitNarratives || []).length
          ? card.visitNarratives.map((line) => `<div>${escapeHtml(line)}</div>`).join('')
          : '<div class="muted">本期该产品暂无客服部回访记录</div>'}
      </div>
      ${issue ? `
        <div class="report-group-subtitle">建议举措</div>
        ${readonlyBlock(action)}` : ''}
    </div>
    <div id="${escapeAttr(anchorBase)}-positive" class="report-product-group report-product-group--positive" data-nav-group="positive">
      <div class="report-group-title">正反馈</div>
      ${positiveQuotes.length
        ? positiveQuotes.map((item) => quoteLineHtml(item, 'positive')).join('')
        : '<p class="report-group-empty">本产品本月暂无正反馈原话。</p>'}
    </div>
  </section>`
}

function appendixSectionHtml(label, content) {
  return `<details class="appendix-section">
    <summary>${escapeHtml(label)}</summary>
    <div class="appendix-section__content">${content}</div>
  </details>`
}

const OFFLINE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif; background: #e8eaed; color: #1f2937; }
.post-use-html-report { min-height: 100vh; background: #e8eaed; color: #1f2937; }
.post-use-html-report-sheet { display: flex; align-items: flex-start; gap: 24px; padding: 24px 24px 48px; }
.report-sheet-main { flex: 1; min-width: 0; }
.report-modules { display: flex; flex-direction: column; gap: 12px; }
.report-module { background: #fff; border-radius: 8px; padding: 20px 24px; }
.report-title { margin: 0; font-size: 24px; line-height: 1.2; }
.offline-banner { margin: 0 0 16px; font-size: 12px; color: #6b7280; }
.report-alert { margin-top: 16px; border: 1px solid #dbeafe; border-radius: 8px; padding: 12px 14px; background: #f8fbff; }
.report-alert--warn { border-color: #fde68a; background: #fffbea; }
.report-alert__title { font-weight: 600; margin-bottom: 6px; }
.report-alert ul { margin: 0; padding-left: 20px; }
.section-title { margin: 0 0 12px; font-size: 16px; line-height: 1.3; font-weight: 600; }
.readonly-block { border: 1px solid #d9d9d9; border-radius: 8px; padding: 10px 12px; background: #fff; line-height: 1.7; font-size: 14px; min-height: 56px; }
.field-label { margin: 14px 0 8px; font-size: 14px; font-weight: 500; color: #6b7280; }
.post-use-html-report-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 16px 0 20px; }
.post-use-html-report-kpis--product { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.post-use-html-report-kpi { border: 1px solid #e5e7eb; padding: 12px 14px; border-radius: 8px; }
.post-use-html-report-kpi--warn { border-color: #f0b4b4; background: #fff7f7; }
.post-use-html-report-kpi--ok { border-color: #b7dcc4; background: #f5fbf6; }
.post-use-html-report-kpi .label { font-size: 12px; color: #6b7280; }
.post-use-html-report-kpi .value { margin-top: 4px; font-size: 22px; font-weight: 650; letter-spacing: -0.02em; }
.post-use-html-report-kpi-hints { margin-top: 6px; font-size: 12px; line-height: 1.45; color: #6b7280; }
.post-use-html-report-kpi-hints--inline { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 12px; row-gap: 2px; }
.post-use-html-report-kpi-hints .hint--up { color: #166534; }
.post-use-html-report-kpi-hints .hint--down { color: #991b1b; }
.post-use-html-report-kpi-hints .hint--flat, .post-use-html-report-kpi-hints .hint--na { color: #6b7280; }
.report-product-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 16px; margin-bottom: 16px; }
.report-product-list { display: flex; flex-direction: column; gap: 6px; }
.report-product-list__item { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; text-align: left; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; padding: 8px 10px; cursor: pointer; font: inherit; color: inherit; }
.report-product-list__item:hover { border-color: #c7d2fe; }
.report-product-list__item.is-active { border-color: #4f46e5; background: #eef2ff; }
.report-product-detail { display: none; }
.report-product-detail.is-active { display: block; }
/* ===== 单产品三层结构 + 随屏导航 + 悬浮目录（与线上 PostUseHtmlReport.css 对齐）===== */
.report-group-title { margin: 18px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #1f2937; }
.report-group-title:first-child { margin-top: 0; }
.report-group-subtitle { margin: 12px 0 6px; font-size: 12px; font-weight: 500; color: #6b7280; }
.report-product-group + .report-product-group { margin-top: 6px; }
.report-group-empty { margin: 8px 0; font-size: 13px; color: #9ca3af; }
.report-product-nav { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; padding: 8px 0; background: #fff; border-bottom: 1px solid #e5e7eb; }
.report-product-nav__item { padding: 4px 10px; border: 1px solid #e5e7eb; border-radius: 999px; font-size: 12px; color: #4b5563; text-decoration: none; }
.report-product-nav__item:hover { border-color: #4f46e5; color: #4f46e5; }
.report-product-nav__item.is-active { border-color: #4f46e5; background: #eef2ff; color: #3730a3; }
/* 右侧常驻目录：sticky 始终可见，点击一级/二级均滚动到对应位置。top 与 sheet padding-top 对齐确保顶部跟左侧齐 */
.report-toc { position: sticky; top: 24px; flex-shrink: 0; width: 240px; max-height: calc(100vh - 48px); overflow-y: auto; margin-top: 0; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06); }
.report-toc__list, .report-toc__sublist { margin: 0; padding: 0; list-style: none; }
.report-toc__list > li { margin-bottom: 4px; }
.report-toc__list a { color: #4b5563; font-size: 13px; text-decoration: none; line-height: 1.6; cursor: pointer; }
.report-toc__list a:hover { color: #4f46e5; }
.report-toc__list a.is-active { color: #3730a3; font-weight: 600; }
.report-toc__sublist { padding-left: 12px; margin-top: 2px; }
.report-toc__sublist a { font-size: 12px; color: #6b7280; }
.report-toc__product.is-active { color: #3730a3; font-weight: 600; }
@media (max-width: 1024px) { .report-toc { display: none; } .post-use-html-report-sheet { padding: 16px 16px 40px; } }
@media print { .report-toc, .report-product-nav { display: none !important; } }
.report-visual-panel { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
.report-visual-panel__title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.report-chart-empty, .report-table-empty, .muted { display: flex; align-items: center; justify-content: center; min-height: 80px; font-size: 13px; color: #9ca3af; }
.report-chart-shell { position: relative; }
svg.chart { display: block; height: auto; max-width: 100%; }
.svg-label { font-size: 11px; fill: #6B7280; }
.svg-ref-label { font-size: 11px; font-weight: 600; }
.chart-hit { cursor: default; outline: none; }
.report-visual-legend { display: flex; flex-wrap: wrap; gap: 8px 12px; margin-top: 8px; font-size: 12px; color: #4b5563; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.legend-swatch { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
.quote-pill { display: inline-flex; align-items: center; justify-content: center; padding: 0 6px; min-height: 20px; border-radius: 999px; font-size: 12px; line-height: 1.5; }
.quote-pill--positive { background: #dcfce7; color: #166534; }
.quote-pill--negative { background: #fee2e2; color: #991b1b; }
.quote-pill--neutral { background: #eef2ff; color: #3730a3; }
.report-product-detail h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
.post-use-html-report-evidence { margin: 10px 0 12px; padding: 10px 12px; background: #f9fafb; border: 1px solid #eef0f3; border-radius: 8px; font-size: 12px; line-height: 1.65; }
.post-use-html-report-quote { display: block; margin: 6px 0 0; color: inherit; text-decoration: none; }
.report-evidence-hint { margin-bottom: 6px; color: #4b5563; }
.report-score-meter { margin-bottom: 8px; }
.report-score-meter__track { position: relative; height: 8px; background: #eef0f3; border-radius: 999px; overflow: hidden; }
.report-score-meter__fill { display: block; height: 100%; background: #4b7bec; }
.report-score-meter__mark { position: absolute; top: -2px; width: 1px; height: 12px; background: #111827; }
.report-score-meter__caption { margin-top: 4px; font-size: 12px; color: #4b5563; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f9fafb; }
.appendix-section { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
.appendix-section + .appendix-section { margin-top: 8px; }
.appendix-section summary { cursor: pointer; list-style: none; padding: 12px 14px; font-size: 14px; font-weight: 600; }
.appendix-section summary::-webkit-details-marker { display: none; }
.appendix-section summary::after { content: '展开'; float: right; font-size: 12px; color: #6b7280; }
.appendix-section[open] summary::after { content: '收起'; }
.appendix-section__content { padding: 0 14px 14px; }
.report-lead-note { justify-content: flex-start; min-height: 0; color: #6b7280; font-size: 14px; line-height: 1.65; margin: 4px 0 8px; }
.screen-only-hidden { display: none; }
.chart-hover-tooltip { position: fixed; z-index: 1000; pointer-events: none; max-width: 280px; padding: 8px 10px; border-radius: 8px; background: rgba(17, 24, 39, 0.94); color: #fff; font-size: 12px; line-height: 1.45; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18); white-space: nowrap; }
@media (max-width: 900px) {
  .post-use-html-report-kpis,
  .report-product-layout,
  .post-use-html-report-kpis--product { grid-template-columns: 1fr; }
}
@media print {
  .post-use-html-report { background: #fff; }
  .post-use-html-report-sheet { display: block; padding: 0; }
  .report-module { border: 1px solid #e5e7eb; break-inside: avoid; }
  .report-product-list { display: none; }
  .report-product-layout { display: block; }
  .report-product-detail { display: block; break-inside: avoid; margin-bottom: 16px; }
  .appendix-section[open] .appendix-section__content { display: block; }
  .chart-hover-tooltip { display: none !important; }
  @page { size: A4; margin: 14mm; }
}
`

const OFFLINE_JS = `
(function () {
  var tabs = Array.from(document.querySelectorAll('[data-product-tab]'))
  var panels = Array.from(document.querySelectorAll('[data-product-panel]'))
  function activate(productName, scrollTarget) {
    tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-product-tab') === productName
      tab.classList.toggle('is-active', active)
      tab.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
    panels.forEach(function (panel) {
      panel.classList.toggle('is-active', panel.getAttribute('data-product-panel') === productName)
    })
    document.querySelectorAll('.report-toc__product').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-toc-product') === productName)
    })
    if (scrollTarget) {
      var node = document.getElementById(scrollTarget)
      if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      activate(tab.getAttribute('data-product-tab'))
    })
  })
  if (tabs.length) activate(tabs[0].getAttribute('data-product-tab'))

  // 右侧悬浮目录：开合 + 章节锚点 + 产品子项联动切换
  var tocRoot = document.querySelector('.report-toc')
  if (tocRoot) {
    tocRoot.querySelectorAll('.report-toc__list a[data-toc-section]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault()
        var node = document.getElementById(link.getAttribute('data-toc-section'))
        if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
    tocRoot.querySelectorAll('.report-toc__product').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault()
        activate(link.getAttribute('data-toc-product'))
        var productsNode = document.getElementById('report-products')
        if (productsNode && productsNode.scrollIntoView) productsNode.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  // 右侧常驻目录：滚动高亮当前章节（IntersectionObserver）
  if ('IntersectionObserver' in window && tocRoot) {
    var tocLinks = Array.from(tocRoot.querySelectorAll('.report-toc__list a[data-toc-section]'))
    var tocObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        var id = entry.target.id
        tocLinks.forEach(function (link) {
          link.classList.toggle('is-active', link.getAttribute('data-toc-section') === id)
        })
      })
    }, { rootMargin: '-96px 0px -60% 0px', threshold: 0 })
    tocLinks.forEach(function (link) {
      var node = document.getElementById(link.getAttribute('data-toc-section'))
      if (node) tocObserver.observe(node)
    })
  }

  // 单产品随屏导航：锚点跳转 + 当前分组高亮（IntersectionObserver）
  if ('IntersectionObserver' in window) {
    var navLinks = Array.from(document.querySelectorAll('.report-product-nav__item'))
    navLinks.forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault()
        var node = document.getElementById(link.getAttribute('href').slice(1))
        if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        var group = entry.target.getAttribute('data-nav-group')
        navLinks.forEach(function (link) {
          link.classList.toggle('is-active', link.getAttribute('data-nav-group') === group)
        })
      })
    }, { rootMargin: '-96px 0px -60% 0px', threshold: 0 })
    document.querySelectorAll('.report-product-group[data-nav-group]').forEach(function (group) {
      observer.observe(group)
    })
  }

  var tooltip = document.getElementById('offline-chart-tooltip')
  if (!tooltip) return
  var position = function (event) {
    tooltip.style.left = (event.clientX + 14) + 'px'
    tooltip.style.top = (event.clientY + 14) + 'px'
  }
  document.querySelectorAll('[data-tooltip]').forEach(function (node) {
    node.addEventListener('mouseenter', function (event) {
      tooltip.textContent = node.getAttribute('data-tooltip') || ''
      tooltip.hidden = false
      position(event)
    })
    node.addEventListener('mousemove', position)
    node.addEventListener('mouseleave', function () {
      tooltip.hidden = true
    })
    node.addEventListener('focus', function () {
      tooltip.textContent = node.getAttribute('data-tooltip') || ''
      tooltip.hidden = false
    })
    node.addEventListener('blur', function () {
      tooltip.hidden = true
    })
  })
})()
`

/**
 * 生成可双击打开的离线 HTML，布局与线上月报保持一致，交互保持为只读浏览态。
 * @param {{
 *   model: object
 *   judgment?: string
 *   todoNote?: string
 *   todoItems?: { id: string, content: string, owner: string, team: string, source: 'manual' | 'auto' }[]
 *   issueNarratives?: Record<string, { conclusion: string, action: string }>
 *   visitSupplements?: Record<string, { visitResult: string, internalConclusion: string, remark: string }>
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
  const todoItems = input.todoItems ?? model.todoItems ?? []
  const issueNarratives = input.issueNarratives || {}
  const visitSupplements = input.visitSupplements || {}
  const exportedAt = input.exportedAt || new Date().toISOString()
  const copy = model.copy || {}
  const kpis = model.kpis || {}
  const charts = model.charts || {}
  const preview = model.preview || {}
  const reviewItems = preview.reviewChecklist || []
  const productCards = model.productCards || []
  const statusChart = svgTrendChart(charts.statusTrend, {
    kind: 'combined',
    width: CHART_WIDTHS.statusOverview,
    height: 300,
    referenceLines: [
      { y: POST_USE_SCORE_BASELINE, label: '关注线 9', yAxisId: 'score' },
      {
        y: POST_USE_SATISFACTION_BASELINE * 100,
        label: '达标线 88%',
        yAxisId: 'rate',
        stroke: '#059669',
      },
    ],
  })

  const productsHtml = hidden.has(REPORT_SECTION_PRODUCTS)
    ? ''
    : `<section class="report-module">
      <h2 class="section-title" id="report-products">分产品情况</h2>
      <div class="report-product-layout">
        <div class="report-product-list">
          ${productCards.map((card, index) => `<button
            type="button"
            class="report-product-list__item${index === 0 ? ' is-active' : ''}"
            data-product-tab="${escapeAttr(card.productName)}"
            aria-pressed="${index === 0 ? 'true' : 'false'}"
          >
            <span>${escapeHtml(card.productName)}</span>
            <span>${escapeHtml(formatScore(card.mixedAvg))}</span>
            ${card.belowNine ? '<span class="quote-pill quote-pill--negative">低于 9</span>' : ''}
            ${card.callbackUnqualified ? '<span class="quote-pill quote-pill--neutral">回访不达标</span>' : ''}
          </button>`).join('')}
        </div>
        <div>
          ${productCards.map((card, index) => productCardHtml(card, preview, issueNarratives, index === 0)).join('') || '<div class="report-chart-empty">当月暂无产品评分。</div>'}
        </div>
      </div>
    </section>`

  const todo = model.todo || {}
  // 只读快照过滤掉编辑中尚未填写内容的行（线上编辑态允许保留空行）
  const visibleTodoItems = (todoItems || []).filter((item) => String(item?.content || '').trim())
  const todoItemsHtml = tableHtml(
    ['事项', '负责人', '班组'],
    visibleTodoItems.map((item) => [text(item.content), text(item.owner), text(item.team)]),
    '暂无待办事项',
  )
  const todoHtml = hidden.has(REPORT_SECTION_TODO)
    ? ''
    : `<section class="report-module">
      <h2 class="section-title" id="report-todo">待办事项及进展</h2>
      <div class="post-use-html-report-kpis">
        <div class="post-use-html-report-kpi"><div class="label">${escapeHtml(copy.todoProposed || '本月提出')}</div><div class="value">${todo.proposedCount || 0}</div></div>
        <div class="post-use-html-report-kpi"><div class="label">${escapeHtml(copy.todoClosed || '本月关闭')}</div><div class="value">${todo.closedCount || 0}</div></div>
        <div class="post-use-html-report-kpi${todo.notRecoveredCount ? ' post-use-html-report-kpi--warn' : ''}"><div class="label">已完成未恢复</div><div class="value">${todo.notRecoveredCount || 0}</div></div>
        <div class="post-use-html-report-kpi"><div class="label">建议回访/溯源</div><div class="value">${todo.callbackCount || 0}</div></div>
      </div>
      ${todoItemsHtml}
      ${readonlyBlock(todoNote, copy.todoPlaceholder || '输出备注/说明')}
    </section>`

  const previousVisits = (model.previousVisits || []).map((row) => {
    const supplement = visitSupplements[row.id] || {}
    return {
      ...row,
      visitResult: supplement.visitResult ?? row.visitResult,
      internalConclusion: supplement.internalConclusion ?? row.internalConclusion,
      remark: supplement.remark ?? row.remark,
    }
  })
  const previousVisitsHtml = model.showPreviousVisits === false || hidden.has(REPORT_SECTION_PREVIOUS_VISITS)
    ? ''
    : `<section class="report-module">
      <h2 class="section-title" id="report-previous-visits">上期客服部回访结果补充</h2>
      ${previousVisits.length
        ? tableHtml(
          ['客户', '客服部回访记录', '回访结果内部评估/回应', '备注'],
          previousVisits.map((row) => [text(row.customerName), text(row.visitResult), text(row.internalConclusion), text(row.remark)]),
        )
        : '<div class="report-table-empty">上期无客服部回访记录。</div>'}
    </section>`

  const appendixHtml = hidden.has(REPORT_SECTION_APPENDIX)
    ? ''
    : `<section class="report-module report-appendix">
      <h2 class="section-title" id="report-appendix">附录</h2>
      ${appendixSectionHtml('整体得分表', tableHtml(
        ['产品', '样本量', '均分', '投诉回访10分满意比'],
        (preview.monthlyScoreTable || []).map((row) => [text(row.productName), text(row.sampleSize), text(row.avgScore), text(row.callbackTenPointRate)]),
      ))}
      ${appendixSectionHtml('评分分布', tableHtml(
        ['产品', '样本', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
        (preview.scoreDistributionTable || []).map((row) => [text(row.productName), text(row.sampleSize), text(row['10']), text(row['9']), text(row['8']), text(row['7']), text(row['6']), text(row['5']), text(row['4']), text(row['3']), text(row['2']), text(row['1'])]),
      ))}
      ${appendixSectionHtml('用户旅程', `${svgJourneyCombo(preview.journeyDistribution || [], { width: CHART_WIDTHS.appendixJourney, height: 240 })}${tableHtml(
        ['产品', '旅程', '样本', '均分', '非10分'],
        (preview.journeyDistribution || []).map((row) => [text(row.productName), text(row.journey), text(row.sampleSize), text(row.avgScore), text(row.nonTenCount)]),
      )}`)}
      ${appendixSectionHtml('客户明细', tableHtml(
        ['客户', '编码', '产品', '非10分', '均分', '最近原话'],
        (preview.customers || []).map((row) => [text(row.customerName), text(row.customerCode), escapeHtml((row.products || []).join('、') || '—'), text(row.nonTenCount), text(row.avgScore), text(row.latestQuote)]),
      ))}
      ${appendixSectionHtml('有效客户原话登记', tableHtml(
        ['渠道', '正负', '类型', '产品', '得分', '客户名称/编码', '时间', '原文'],
        (model.quoteRegistry || []).map((row) => [
          text(row.channelLabel),
          escapeHtml(polarityLabel(row.polarity)),
          escapeHtml(row.kind === 'quote' ? '客户原话' : '反馈选项'),
          text(row.productName),
          text(row.score),
          escapeHtml([row.customerName, row.customerCode].filter(Boolean).join(' / ') || '—'),
          text(row.answeredAt),
          text(row.text),
        ]),
      ))}
      ${model.overflow?.length ? appendixSectionHtml(
        '正文未收录的问题条',
        `<ul>${model.overflow.map((issue) => `<li>${text(issue.productName)}：${text(issue.conclusionDraft)}</li>`).join('')}</ul>`,
      ) : ''}
    </section>`

  // 右侧悬浮目录：与线上 ReportToc 同构（章节 + 分产品子列表），hidden 章节不列。
  const tocSections = [
    { id: 'report-judgment', label: copy.overviewTitle || '本月概述' },
    ...(hidden.has(REPORT_SECTION_PRODUCTS) ? [] : [{ id: 'report-products', label: '分产品情况' }]),
    ...(hidden.has(REPORT_SECTION_TODO) ? [] : [{ id: 'report-todo', label: '待办事项及进展' }]),
    ...(model.showPreviousVisits === false || hidden.has(REPORT_SECTION_PREVIOUS_VISITS)
      ? []
      : [{ id: 'report-previous-visits', label: '上期客服部回访结果补充' }]),
    ...(hidden.has(REPORT_SECTION_APPENDIX) ? [] : [{ id: 'report-appendix', label: '附录' }]),
  ]
  const tocHtml = `<nav class="report-toc" aria-label="报告目录">
      <ul class="report-toc__list">
        ${tocSections.map((section) => `<li>
          <a href="#${section.id}" data-toc-section="${section.id}">${escapeHtml(section.label)}</a>
          ${section.id === 'report-products' && productCards.length
            ? `<ul class="report-toc__sublist">${productCards.map((card, index) => `<li><a href="#report-products" class="report-toc__product${index === 0 ? ' is-active' : ''}" data-toc-product="${escapeAttr(card.productName)}">${escapeHtml(card.productName)}</a></li>`).join('')}</ul>`
            : ''}
        </li>`).join('')}
      </ul>
    </nav>`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${text(model.title, `用后即评月报（${model.reportMonth || ''}）`)}</title>
  <style>${OFFLINE_CSS}</style>
</head>
<body class="post-use-html-report">
  <div class="post-use-html-report-sheet">
    <div class="report-sheet-main">
    <article class="report-modules">
      <section class="report-module">
        <p class="offline-banner">离线快照 · 导出于 ${escapeHtml(exportedAt)} · 页面布局与浏览交互已对齐线上月报</p>
        <h1 class="report-title">${text(model.title)}</h1>
        ${reviewAlertHtml(reviewItems)}
        ${model.tablesRefreshed ? warningAlertHtml('表格已按最新数据刷新，叙述仍是上次保存') : ''}
      </section>

      <section class="report-module">
        <h2 class="section-title" id="report-judgment">${escapeHtml(copy.overviewTitle || '本月概述')}</h2>
        ${readonlyBlock(judgment, copy.overviewPlaceholder || '结合综合结论写清当月整体表现，不要改指标数字。')}
        <div class="post-use-html-report-kpis">
          <div class="post-use-html-report-kpi"><div class="label">涉及产品数</div><div class="value">${kpis.productCount ?? 0}</div><div class="post-use-html-report-kpi-hints">总样本量 ${kpis.totalSample ?? 0}</div></div>
          <div class="post-use-html-report-kpi post-use-html-report-kpi--${Number(kpis.avgScore) < POST_USE_SCORE_BASELINE ? 'warn' : 'ok'}"><div class="label">部门均分（三渠道）</div><div class="value">${escapeHtml(formatScore(kpis.avgScore))}</div>${kpiHints(kpis)}</div>
          <div class="post-use-html-report-kpi${kpis.belowNineCount ? ' post-use-html-report-kpi--warn' : ''}"><div class="label">9 分以下产品数</div><div class="value">${kpis.belowNineCount ?? 0}</div><div class="post-use-html-report-kpi-hints">${escapeHtml((kpis.belowNineNames || []).join('、') || '无')}</div></div>
          <div class="post-use-html-report-kpi${kpis.callbackUnqualifiedCount ? ' post-use-html-report-kpi--warn' : ''}"><div class="label">投诉回访不达标产品数</div><div class="value">${kpis.callbackUnqualifiedCount ?? 0}</div><div class="post-use-html-report-kpi-hints">${escapeHtml((kpis.callbackUnqualifiedNames || []).join('、') || '无')}</div></div>
        </div>
        <div class="report-visual-panel">${statusChart}</div>
      </section>

      ${productsHtml}
      ${todoHtml}
      ${previousVisitsHtml}
      ${appendixHtml}
    </article>
    </div>
    ${tocHtml}
  </div>
  <div id="offline-chart-tooltip" class="chart-hover-tooltip" hidden></div>
  <script>${OFFLINE_JS}</script>
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
