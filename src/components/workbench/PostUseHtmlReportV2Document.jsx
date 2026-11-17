import { useEffect, useMemo, useState } from 'react'
import { scoreAxisDomain } from '../../lib/postUseRating/insights.js'
import { reportV2QuoteCategory } from '../../lib/postUseRating/reportV2Model.js'
import { REPORT_SECTION_APPENDIX, REPORT_SECTION_PREVIOUS_VISITS, REPORT_SECTION_PRODUCTS, REPORT_SECTION_TODO } from '../../lib/postUseRating/htmlReportModel.js'
import { isValidCustomerText } from '../../lib/postUseRating/reasonTaxonomy.js'
import FieldLabel from '../FieldLabel.jsx'

function number(value, fallback = '—') {
  return value == null || !Number.isFinite(Number(value)) ? fallback : String(value)
}

function monthLabel(month) {
  return `${Number(String(month).slice(5))}月`
}

function mask(value) {
  const text = String(value || '').trim()
  if (!text) return '—'
  if (text.length <= 2) return `${text[0]}****`
  return `${text.slice(0, 1)}****${text.slice(-1)}`
}

function percent(part, total) {
  return total ? `${Math.round(part / total * 1000) / 10}%` : '—'
}

function signedDiff(current, previous) {
  const diff = current - previous
  return `${diff > 0 ? '+' : ''}${diff}`
}

function monthList(months) {
  return months.length ? months.map(monthLabel).join('、') : '无'
}

function ratingChannelLabel(channel) {
  return { sms: '短信', console: '控制台', callback: '投诉回访', option: '反馈选项' }[channel] || '其他'
}

function callbackDisplay(product, kind, months) {
  if (product.callbackRate == null) return '—（无工单）'
  if (kind !== 'quarter' || product.callbackMonths.length === months.length) return `${product.callbackRate}%`
  return `${product.callbackRate}%（仅${monthList(product.callbackMonths)}有工单）`
}

function QuarterTrendText({ rows }) {
  const values = rows.filter((row) => row.value != null)
  const low = values.length ? Math.min(...values.map((row) => row.value)) : null
  return rows.map((row, index) => <span key={row.month} className={row.value != null && row.value === low ? 'v2-danger' : ''}>
    {index ? ' → ' : ''}{number(row.value)}（{monthLabel(row.month)}{row.value != null && row.value === low ? '低点' : ''}）
  </span>)
}

function tag(label, tone = 'muted') {
  return <span className={`v2-tag v2-tag--${tone}`}>{label}</span>
}

function problemRowClass(row) {
  if (row.type === 'ten-option') return ''
  if (row.isNew) return 'v2-row-warning'
  return row.priority === 'P0' ? 'v2-row-danger' : ''
}

function reasonRowClass(row) {
  if (row.type === 'ten-option') return ''
  if (row.isNew) return 'v2-row-warning'
  return row.lowestScore <= 5 ? 'v2-row-danger' : ''
}

function problemThemeGroup(theme, type, productName) {
  const text = String(theme || '').trim()
  if (type === 'ten-option') {
    if (/购买时参数|配置选择错误/.test(text)) return '购买时参数/配置选择错误'
    if (/产品价格|价格没有优势|操作过于复杂|服务不好用/.test(text)) return '价格无优势 / 操作过于复杂'
    if (/不满足业务部署/.test(text)) return '不满足业务部署要求'
    return text
  }
  if (/功能有缺失|功能缺失.?不完善|无法绑定|不能绑定/.test(text)) return '功能缺失/不完善'
  if (/MOP.*退订|KCS.*退订|关联退订失败/.test(text)) return 'MOP 退订链路'
  if (/IP地区|IP 地区|地域.*IP|福建厦门.*北京/.test(text)) return 'IP 地域匹配'
  if (/配置规格|帮助说明|内容\/帮助|缺乏操作指引|帮助文档/.test(text)) return '配置选择与帮助文档'
  if (productName === '弹性公网IP' && /共享带宽|双栈带宽|批量.*退|IP不能.*退/.test(text)) return '共享带宽能力限制'
  if (/任务操作流程|界面布局|网络安全|多线BGP/.test(text)) return '操作与安全类'
  return text
}

function groupedLifecycle(monthCounts, months) {
  const counts = months.map((month) => monthCounts[month] || 0)
  const active = counts.filter(Boolean).length
  if (!active) return ''
  if (counts.at(-1) === 0 && counts.slice(0, -1).some(Boolean)) return '已收敛（末月无）'
  if (active === months.length) return '贯穿全季'
  if (active === 1) return `单月（${monthLabel(months[counts.findIndex(Boolean)])}）`
  const max = Math.max(...counts)
  const peak = counts.indexOf(max)
  if (max >= 2 * (counts.reduce((sum, value) => sum + value, 0) - max)) return `${monthLabel(months[peak])}集中爆发`
  return ''
}

function problemThemeRows(themes, productName, months, kind) {
  const priorityRank = { P0: 0, P1: 1, P2: 2 }
  const grouped = new Map()
  for (const theme of themes) {
    const label = problemThemeGroup(theme.theme, theme.type, productName)
    const key = `${theme.type}\0${label}`
    const row = grouped.get(key) || {
      ...theme, key, theme: label, count: 0, segmentCount: 0, lowestScore: null,
      priority: 'P2', isNew: false, recordIds: [], customerKeys: [], monthRecordIds: {}, monthFallbackCounts: {}, memberThemes: [],
    }
    row.segmentCount = (row.segmentCount || 0) + (theme.segmentCount || 0)
    row.lowestScore = row.lowestScore == null ? theme.lowestScore : Math.min(row.lowestScore, theme.lowestScore)
    if (priorityRank[theme.priority] < priorityRank[row.priority]) row.priority = theme.priority
    row.isNew ||= theme.isNew
    row.recordIds = [...new Set([...row.recordIds, ...(theme.recordIds || [])])]
    row.customerKeys = [...new Set([...row.customerKeys, ...(theme.customerKeys || [])])]
    row.memberThemes.push(theme.theme)
    for (const month of months) {
      const ids = theme.monthRecordIds?.[month]
      row.monthRecordIds[month] = [...new Set([...(row.monthRecordIds[month] || []), ...(ids || [])])]
      row.monthFallbackCounts[month] = (row.monthFallbackCounts[month] || 0) + (theme.monthCounts?.[month] || 0)
    }
    grouped.set(key, row)
  }
  return [...grouped.values()].map((row) => {
    const monthCounts = Object.fromEntries(months.map((month) => [month,
      row.monthRecordIds[month]?.length || row.monthFallbackCounts[month] || 0]))
    return {
      ...row,
      count: row.recordIds.length,
      monthCounts,
      lifecycle: kind === 'quarter' ? groupedLifecycle(monthCounts, months) : '',
    }
  }).sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]
    || Number(a.type === 'ten-option') - Number(b.type === 'ten-option')
    || a.lowestScore - b.lowestScore || b.count - a.count)
}

function evidenceText(item, type) {
  return type === 'visit'
    ? String(item?.visitResult || item?.visitFeedbackDetail || '').trim()
    : String(item?.recommendedReason || item?.progress || '').trim()
}

function representativeEvidence(items, themes, type) {
  const idField = type === 'visit' ? 'linkedVisitIds' : 'linkedTraceIds'
  const linkedIds = themes.flatMap((row) => row[idField] || []).map(String)
  const linked = linkedIds.map((id) => items.find((item) => String(item.id) === id)).find(Boolean)
  if (linked) return linked
  return items.find((item) => /不满|未解决|需要优化|缺陷|故障|异常|无法回访|测试账号|清退/.test(evidenceText(item, type)))
    || items.find((item) => evidenceText(item, type)) || null
}

function Section({ id, title, children, className = '' }) {
  return <section id={id} className={`report-module v2-section ${className}`}><h2 className="v2-section-title">{title}</h2>{children}</section>
}

function Metric({ label, value, hint, tone = '' }) {
  return <div className={`post-use-html-report-kpi v2-metric ${tone ? `v2-metric--${tone}` : ''}`}>
    <div className="label">{label}</div><div className="value">{value}</div>
    {hint ? <div className="post-use-html-report-kpi-hints">{hint}</div> : null}
  </div>
}

function TrendSvg({ series, months, min, max, baseline = null, baselineLabel = '', quarterMonths = [], suffix = '', missingLabel = '', tickStep = 1, emphasizeLow = false, compact = false }) {
  const width = compact ? 400 : 760; const height = 245
  const left = 38; const right = 52; const top = 24; const bottom = 36
  const plotW = width - left - right; const plotH = height - top - bottom
  const x = (index) => left + (months.length <= 1 ? plotW / 2 : index * plotW / (months.length - 1))
  const y = (value) => top + (max - value) / (max - min || 1) * plotH
  const ticks = Array.from({ length: Math.floor((max - min) / tickStep) + 1 }, (_, index) => min + index * tickStep)
  const quarterIndexes = months.map((month, index) => quarterMonths.includes(month) ? index : -1).filter((index) => index >= 0)
  const bandStart = quarterIndexes.length ? Math.max(left, x(quarterIndexes[0]) - plotW / Math.max(1, months.length - 1) / 2) : 0
  const bandEnd = quarterIndexes.length ? Math.min(width - right, x(quarterIndexes.at(-1)) + plotW / Math.max(1, months.length - 1) / 2) : 0
  const pathSegments = (data) => {
    const segments = []; let current = []
    data.forEach((row, index) => {
      if (row?.value == null || !Number.isFinite(Number(row.value))) {
        if (current.length) segments.push(current)
        current = []
      } else current.push(`${x(index)},${y(Number(row.value))}`)
    })
    if (current.length) segments.push(current)
    return segments
  }
  return <div className={`v2-chart-wrap ${compact ? 'v2-chart-wrap--compact' : ''}`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.map((item) => item.name).join('、')}趋势`}>
      {quarterIndexes.length ? <><rect x={bandStart} y={top} width={bandEnd - bandStart} height={plotH} fill="#eef2ff" /><text x={bandStart + 5} y={top + 13} className="v2-svg-label">Q{Math.ceil(Number(quarterMonths[0]?.slice(5)) / 3)}</text></> : null}
      {ticks.map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="#e5e7eb" strokeDasharray="3 3" /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="v2-svg-label">{tick}{suffix}</text></g>)}
      {baseline != null && baseline >= min && baseline <= max ? <g><line x1={left} x2={width - right} y1={y(baseline)} y2={y(baseline)} stroke={suffix === '%' ? '#059669' : '#d97706'} strokeDasharray="6 4" /><text x={width - right - 4} y={y(baseline) - 6} textAnchor="end" className="v2-svg-label" fill={suffix === '%' ? '#047857' : '#b45309'}>{baselineLabel || baseline}</text></g> : null}
      {months.map((month, index) => <text key={month} x={x(index)} y={height - 11} textAnchor="middle" className={`v2-svg-label ${series.every((item) => item.data[index]?.value == null) ? 'v2-svg-label--missing' : ''}`}>{monthLabel(month)}</text>)}
      {series.map((item) => <g key={item.name}>
        {pathSegments(item.data).filter((segment) => segment.length > 1 && item.data.filter((row) => row?.value != null).length >= 3).map((segment, index) => <polyline key={index} points={segment.join(' ')} fill="none" stroke={item.color} strokeWidth="2.5" />)}
        {item.data.map((row, index) => row?.value == null ? null : <g key={months[index]}><circle cx={x(index)} cy={y(Number(row.value))} r={emphasizeLow && Number(row.value) < 9 && !suffix ? 4.5 : 3.5} fill={emphasizeLow && Number(row.value) < 9 && !suffix ? '#dc2626' : item.color}><title>{`${monthLabel(months[index])} ${item.name} ${row.value}${suffix}`}</title></circle>{item.data.filter((point) => point?.value != null).length < 3 || suffix ? <text x={x(index)} y={y(Number(row.value)) - 9} textAnchor="middle" className="v2-svg-label">{row.value}{suffix}</text> : null}</g>)}
        {series.length > 1 && item.data.at(-1)?.value != null ? <text x={width - right + 5} y={y(Number(item.data.at(-1).value)) + (item.name === '公司' ? 12 : -4)} className="v2-svg-label" style={{ fill: item.color }}>{item.name}</text> : null}
      </g>)}
      {missingLabel && series.length === 1 ? series[0].data.map((row, index) => row?.value == null ? <text key={months[index]} x={x(index)} y={top + plotH / 2} textAnchor="middle" className="v2-svg-label v2-svg-label--missing">{missingLabel}</text> : null) : null}
    </svg>
    <div className="v2-chart-legend">{series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div>
  </div>
}

function Microbar({ count, max, tone }) {
  return <span className="v2-microbar"><b>{count}</b><span className="v2-microbar-track"><span className={`v2-microbar-fill v2-microbar-fill--${tone}`} style={{ width: `${max ? count / max * 100 : 0}%` }} /></span></span>
}

function DistributionBar({ count, max, tone }) {
  return <span className="v2-distribution-bar"><span className="v2-microbar-track"><span className={`v2-microbar-fill v2-microbar-fill--${tone}`} style={{ width: `${max ? count / max * 100 : 0}%` }} /></span></span>
}

function actionValue(action, overrides) {
  return { ...action, ...(overrides?.[action.id] || {}) }
}

function conclusionText(text, newTheme = '') {
  const highlightNew = newTheme.length > 0 && newTheme.length <= 25 ? newTheme : ''
  const escapedTheme = highlightNew.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = String(text || '').split(new RegExp(`(${escapedTheme ? `${escapedTheme}|` : ''}[1-5](?:\\.\\d+)?\\s*分|连续\\s*\\d+\\s*个?月|功能(?:有)?缺失|稳定性不足故障频发|客户不满)`, 'g'))
  return parts.map((part, index) => {
    if (!part) return null
    const critical = /^(?:[1-5](?:\.\d+)?\s*分|连续\s*\d+\s*个?月|功能(?:有)?缺失|稳定性不足故障频发|客户不满)$/.test(part)
    if (part === highlightNew) return <mark key={index} className="v2-mark-new">{critical ? <strong className="v2-danger">{part}</strong> : part}</mark>
    return critical ? <strong key={index} className="v2-danger">{part}</strong> : part
  })
}

function ActionItem({ action, overrides, canEdit, onActionChange, isFocus = false }) {
  const value = actionValue(action, overrides)
  const actionTone = { 回访跟进: 'followup', 缺陷修复: 'repair', 诉求闭环: 'closure', 持续观察: 'observe' }[value.actionType] || 'observe'
  return <div className={`v2-action ${isFocus ? `v2-action--${actionTone}` : `v2-action--${value.priority.toLowerCase()}`}`}>
    <div className="v2-action-main">{isFocus ? tag(value.actionType || '持续观察', `action-${actionTone}`) : tag(value.priority, value.priority.toLowerCase())} <b>{isFocus ? conclusionText(value.title || value.text, value.isNew ? value.theme : '') : value.text}</b>{value.lifecycle ? <span className="v2-inline-gap">{tag(value.lifecycle, value.lifecycle.startsWith('已收敛') ? 'ok' : 'warning')}</span> : null}</div>
    {isFocus ? <div className="v2-action-detail">{conclusionText(value.detail || `关联 ${value.sourceRecordCount} 条评分记录。`, value.isNew ? value.theme : '')}{value.isNew ? <span className="v2-inline-gap">{tag('NEW', 'warning')}</span> : null}</div> : null}
    <div className="v2-subtle">责任人：{value.owner || '待指派'}{value.team ? `（${value.team}）` : ''} · {isFocus ? `详见分产品—${value.productName}` : `验收：${value.check}`}</div>
    {canEdit ? <details className="v2-edit no-print"><summary>编辑举措</summary><div className="v2-edit-grid">
      <label><FieldLabel required={isFocus}>举措</FieldLabel><input value={value.text} onChange={(event) => onActionChange?.(action.id, 'text', event.target.value)} /></label>
      <label><FieldLabel required={isFocus}>责任人</FieldLabel><input value={value.owner || ''} onChange={(event) => onActionChange?.(action.id, 'owner', event.target.value)} /></label>
      <label><FieldLabel>班组</FieldLabel><input value={value.team || ''} onChange={(event) => onActionChange?.(action.id, 'team', event.target.value)} /></label>
    </div>{isFocus ? <div className="v2-focus-edit"><label><FieldLabel>行动标签</FieldLabel><select value={value.actionType || '持续观察'} onChange={(event) => onActionChange?.(action.id, 'actionType', event.target.value)}>{['回访跟进', '缺陷修复', '诉求闭环', '持续观察'].map((label) => <option key={label} value={label}>{label}</option>)}</select></label><label><FieldLabel required>关注结论</FieldLabel><input value={value.title || ''} onChange={(event) => onActionChange?.(action.id, 'title', event.target.value)} /></label><label><FieldLabel required>补充事实</FieldLabel><textarea value={value.detail || ''} onChange={(event) => onActionChange?.(action.id, 'detail', event.target.value)} /></label></div> : null}</details> : null}
  </div>
}

function EvidenceNote({ product }) {
  if (!product.visits.length && !product.traces.length) return null
  const visit = representativeEvidence(product.visits, product.themes, 'visit')
  const trace = representativeEvidence(product.traces, product.themes, 'trace')
  if (!visit && !trace) return null
  return <div className="v2-note v2-evidence-summary">
    {visit ? <p><b>省代表回访{visit.customerName ? `（${mask(visit.customerName)}）` : ''}：</b><span className={/不满|未解决|仍有问题/.test(evidenceText(visit, 'visit')) ? 'v2-danger' : ''}>{evidenceText(visit, 'visit')}</span>{product.visits.length > 1 ? <span className="v2-subtle">（其余 {product.visits.length - 1} 条见折叠明细）</span> : null}</p> : null}
    {trace ? <p><b>产品部溯源{trace.assigneeName ? `（${trace.assigneeName}）` : ''}：</b>{evidenceText(trace, 'trace')}{product.traces.length > 1 ? <span className="v2-subtle">（其余 {product.traces.length - 1} 条见折叠明细）</span> : null}</p> : null}
    <small>未关联具体问题的记录仅作为产品层背景，不作为任一问题的排除或闭环依据。</small>
  </div>
}

function EvidenceDetails({ product }) {
  if (!product.visits.length && !product.traces.length) return null
  return <div className="v2-evidence-details">
    {product.visits.length ? <><h4>省代表回访记录（{product.visits.length} 条）</h4>{product.visits.map((visit, index) => <p key={visit.id || index}><b>{visit.customerName ? `${mask(visit.customerName)}：` : ''}</b>{evidenceText(visit, 'visit') || '—'}</p>)}</> : null}
    {product.traces.length ? <><h4>产品部溯源记录（{product.traces.length} 条）</h4>{product.traces.map((trace, index) => <p key={trace.id || index}><b>{trace.assigneeName ? `${trace.assigneeName}：` : ''}</b>{evidenceText(trace, 'trace') || '—'}</p>)}</> : null}
  </div>
}

function ProductPanel({ product, index, model, printAll, issueNarratives, onIssueChange, actionOverrides, onActionChange, canEdit }) {
  const productActions = model.actions.filter((row) => row.productName === product.name)
  const themes = product.themes
  const displayThemes = problemThemeRows(themes, product.name, model.months, model.kind)
  const maxCount = Math.max(1, ...displayThemes.map((row) => row.count))
  const showPriority = displayThemes.length > 2
  const themeSegmentCount = themes.reduce((sum, row) => sum + row.segmentCount, 0)
  const themeRecordCount = new Set(themes.flatMap((row) => row.recordIds)).size
  const themeCustomerCount = new Set(themes.flatMap((row) => row.customerKeys)).size
  const prior = product.previousAvg
  const change = prior == null || product.avg == null ? '—' : `${product.avg >= prior ? '+' : ''}${Math.round((product.avg - prior) * 100) / 100}`
  const first = themes[0]
  const defaultConclusion = first
    ? `${model.kind === 'quarter' ? '本季' : '本月'}${product.name}均分 ${number(product.avg)} 分，主要关注「${first.theme}」（${first.count} 条，最低 ${first.lowestScore} 分）。${product.sample <= 1 ? '样本量小，波动暂不下结论；请先核实问题。' : first.priority === 'P0' ? '建议优先核查并明确处理结果。' : '纳入后续观察。'}`
    : `${model.kind === 'quarter' ? '本季' : '本月'}${product.name}均分 ${number(product.avg)} 分，${product.sample <= 1 ? '样本量小，波动暂不下结论。' : '未发现有效低分问题。'}`
  const conclusion = issueNarratives?.[`product:${product.name}`]?.conclusion || defaultConclusion
  const noIssue = !themes.some((row) => row.type === 'low')
  const quarterMonths = model.kind === 'quarter' ? model.months : []
  const lowMonth = product.monthly.filter((row) => row.value != null).sort((a, b) => a.value - b.value)[0]?.month
  const optionCount = themes.filter((row) => row.type === 'ten-option').reduce((sum, row) => sum + row.count, 0)
  const neutralNote = product.neutralCount ? `中性备注 ${product.neutralCount} 条，不计入负反馈。` : ''
  const smallSampleMonths = model.kind === 'quarter' && product.sample <= 5 ? `（发生于${monthList(product.monthly.filter((row) => row.sample).map((row) => row.month))}）` : ''
  return <section className="v2-product-panel" data-product-panel-name={product.name}>
    <div className="v2-product-head"><h3>{index + 1}. {product.name}</h3>{tag(product.smallQuarterSample ? '样本不足' : product.status, product.status === '重点改善' && !product.smallQuarterSample ? 'danger' : 'muted')}<strong className={product.avg < 9 ? 'v2-danger' : ''}>{number(product.avg)} 分</strong><span className="v2-subtle">{model.kind === 'quarter' ? '较上季度' : '较上月'} {change} · 样本 {product.sample}{smallSampleMonths}（上期 {product.previousSample}）</span></div>
    {model.kind === 'quarter' ? <div className="v2-month-pill">月度：{product.monthly.map((row, monthIndex) => <span key={row.month} className={row.month === lowMonth ? 'v2-danger' : ''}>{monthIndex ? ' → ' : ''}{monthLabel(row.month)} {row.sample ? number(row.value) : '无样本'}{row.month === lowMonth ? '（低点）' : ''}</span>)}</div> : null}
    <p className="v2-conclusion">{conclusionText(conclusion, first?.isNew ? first.theme : '')}</p>
    {canEdit ? <details className="v2-edit no-print"><summary>编辑核心结论</summary><textarea value={issueNarratives?.[`product:${product.name}`]?.conclusion ?? defaultConclusion} onChange={(event) => onIssueChange?.(`product:${product.name}`, 'conclusion', event.target.value)} /></details> : null}
    <div className="post-use-html-report-kpis v2-product-kpis">
      <Metric label="均分（三渠道）" value={number(product.avg)} hint={`${model.kind === 'quarter' ? '较上季度' : '较上月'} ${change}`} tone={product.avg < 9 ? 'danger' : ''} />
      <Metric label="样本数" value={product.sample} hint={model.kind === 'quarter' ? product.monthly.filter((row) => row.sample).map((row) => `${monthLabel(row.month)} ${row.sample}`).join(' · ') : `较上月 ${product.previousSample ? signedDiff(product.sample, product.previousSample) : '—'}`} />
      <Metric label="非 10 分" value={product.nonTen} hint={`${percent(product.nonTen, product.sample)}${model.kind === 'quarter' && product.nonTen ? ` · ${monthList(product.nonTenMonths)}` : ''}`} tone={product.nonTen === product.sample ? 'danger' : ''} />
      <Metric label="3 分以下样本" value={product.lowThree} hint={model.kind === 'quarter' ? `发生于${monthList(product.lowThreeMonths)}` : `较上月 ${product.previousSample ? signedDiff(product.lowThree, product.previousLowThree) : '—'}`} />
    </div>
    <div className="v2-panel"><div className="page-card-header"><span className="page-card-title">产品得分趋势</span></div><TrendSvg months={product.trend.map((row) => row.month)} series={[{ name: product.name, color: 'var(--v2-blue)', data: product.trend }]} min={Math.max(1, Math.floor(Math.min(9, ...product.trend.filter((row) => row.value != null).map((row) => row.value)) - 1))} max={10} baseline={9} baselineLabel="关注线 9" quarterMonths={quarterMonths} emphasizeLow /></div>
    {noIssue ? product.nonTen > product.distribution['9']
      ? <div className="v2-state-neutral">本期有 {product.nonTen} 条非 10 分评分，但没有可归因的有效负反馈原话。{product.smallQuarterSample ? '样本不足，波动暂不下结论。' : ''}{neutralNote}下期复核低分记录与新增原话。</div>
      : <div className="v2-state-ok">✓ 无有效低分问题——{product.sample} 条样本中 {product.distribution['10']} 条 10 分、{product.distribution['9']} 条 9 分。{optionCount ? `另有 10 分反馈选项 ${optionCount} 条，单列为低风险。` : ''}{neutralNote}下期仅复核低分记录与新增原话。</div>
      : <div className="v2-panel"><div className="page-card-header"><span className="page-card-title">问题主题分布</span><span className="v2-subtle">{themeRecordCount === 1 ? `${themeSegmentCount} 条片段，同 1 条记录 · ${themeCustomerCount} 名客户` : `${themeSegmentCount} 条片段 / ${themeRecordCount} 条评分记录，按优先级排序`}</span></div>
        <div className="v2-table-scroll"><table className="v2-table v2-theme-table"><thead><tr><th>问题主题</th><th>条数</th><th>分布</th>{model.kind === 'quarter' ? <th>月度分布</th> : null}<th>最低分</th><th>{showPriority ? '优先级' : '类型'}</th>{model.kind === 'quarter' ? <th>生命周期</th> : null}</tr></thead><tbody>{displayThemes.map((row) => <tr key={row.key} className={problemRowClass(row)}><td className={row.type === 'ten-option' ? 'v2-option-text' : ''}><b>{row.theme}</b> {row.isNew && row.type !== 'ten-option' ? tag('NEW', 'warning') : null}{row.memberThemes.length > 1 ? <span className="v2-subtle">（{[...new Set(row.memberThemes)].join('、')}）</span> : null}</td><td><b>{row.count}</b></td><td><DistributionBar count={row.count} max={maxCount} tone={row.type === 'ten-option' ? 'muted' : row.lowestScore <= 5 ? 'danger' : 'warning'} /></td>{model.kind === 'quarter' ? <td>{model.months.map((month) => <span key={month} className={row.monthCounts[month] && row.monthCounts[month] === Math.max(...Object.values(row.monthCounts)) ? 'v2-danger' : ''}>{monthLabel(month)} {row.monthCounts[month] || 0}{month !== model.months.at(-1) ? ' / ' : ''}</span>)}</td> : null}<td className={row.type === 'low' && row.lowestScore <= 5 ? 'v2-danger' : ''}><b>{row.lowestScore}</b></td><td>{showPriority ? tag(row.priority, row.priority.toLowerCase()) : tag(row.type === 'ten-option' ? '10分选项' : row.isNew ? 'NEW' : '低分', row.type === 'ten-option' ? 'muted' : row.isNew ? 'warning' : 'danger')}</td>{model.kind === 'quarter' ? <td>{row.lifecycle ? tag(row.lifecycle, 'warning') : '—'}</td> : null}</tr>)}</tbody></table></div>
      </div>}
    <EvidenceNote product={product} />
    {productActions.length && !noIssue ? <div className="v2-panel"><div className="page-card-header"><span className="page-card-title">建议举措</span></div>{productActions.map((action) => <ActionItem key={action.id} action={action} overrides={actionOverrides} canEdit={canEdit} onActionChange={onActionChange} />)}</div> : null}
    <details className="v2-details" open={printAll || undefined}><summary>明细：全部原话（{product.quotes.filter((quote) => quote.kind !== 'option').length} 条）、回访记录、得分分布</summary><div className="v2-details-content">{product.quotes.map((quote, quoteIndex) => <blockquote key={`${quote.recordId}-${quoteIndex}`} className={`v2-quote v2-quote--${reportV2QuoteCategory(quote) === '中性备注' ? 'neutral' : reportV2QuoteCategory(quote) === '反馈选项' ? 'option' : 'regular'}`}>「{quote.text}」<small>{quote.kind === 'option' ? '反馈选项' : '客户原话'} · 1 次 · {quote.score == null ? '无评分' : `最低 ${quote.score} 分`} · {quote.importMonth ? monthLabel(quote.importMonth) : '月份未记录'} · {quote.answeredAt || '—'} · {mask(quote.customerName || quote.customerCode)}{quote.sourceProductName && quote.sourceProductName !== product.name ? ` · 来源规格：${quote.sourceProductName}` : ''}</small></blockquote>)}<EvidenceDetails product={product} /><p>得分分布：样本 {product.sample} · {Object.entries(product.distribution).map(([score, count]) => `${score}分 ${count}`).join(' / ')}</p>{!product.positiveCount ? <p className="v2-subtle">正反馈：本期无</p> : null}</div></details>
    {product.positive.length ? <div className="v2-positive">正反馈 {product.positiveCount} 条：{product.positive.map((item) => `「${item.text}」· ${item.score} 分 · ${item.answeredAt || '时间未记录'} · ${mask(item.customerName || item.customerCode)}`).join('；')}{product.positiveCount > product.positive.length ? '；其余见附录 D' : ''}</div> : null}
  </section>
}

function SharedBandwidthAppendix({ model, printAll }) {
  const records = (model.products.find((row) => row.name === '弹性公网IP')?.sourceSpecRecords || [])
    .filter((row) => row.sourceProductName === '共享带宽')
  if (!records.length) return null
  return <details className="v2-details" open={printAll || undefined}>
    <summary>附录 E：弹性公网 IP 中包含的共享带宽记录（{records.length} 条）</summary>
    <p className="v2-subtle">共享带宽按产品配置作为弹性公网 IP 的规格计入；其中 {records.filter((row) => row.countedInScore).length} 条计入评分样本，反馈选项记录单列且不计入均分。</p>
    <div className="v2-table-scroll"><table className="v2-table"><thead><tr><th>原始规格</th><th>月份</th><th>得分</th><th>渠道</th><th>客户</th><th>评价时间</th></tr></thead><tbody>{records.map((row, rowIndex) => <tr key={`${row.recordId}-${rowIndex}`}><td>{row.sourceProductName}</td><td>{monthLabel(row.importMonth)}</td><td>{number(row.score)}</td><td>{ratingChannelLabel(row.channel)}</td><td>{mask(row.customerName || row.customerCode)}</td><td>{row.answeredAt || '—'}</td></tr>)}</tbody></table></div>
  </details>
}

export default function PostUseHtmlReportV2Document({ model, canEdit = false, printAll = false, issueNarratives = {}, onIssueChange = null, actionOverrides = {}, onActionChange = null, todoItems = [], onTodoItemsChange = null, hiddenSectionIds = [], keyCustomers = [] }) {
  const hidden = useMemo(() => new Set(hiddenSectionIds), [hiddenSectionIds])
  const [selectedProduct, setSelectedProduct] = useState(model.products[0]?.name || '')
  useEffect(() => { if (!model.products.some((row) => row.name === selectedProduct)) setSelectedProduct(model.products[0]?.name || '') }, [model.products, selectedProduct])
  const [activeSection, setActiveSection] = useState('report-v2-overview')
  const sections = useMemo(() => [
    ['report-v2-overview', model.kind === 'quarter' ? '本季概述' : '本月概述'],
    ...(!hidden.has(REPORT_SECTION_PRODUCTS) ? [['report-v2-products', '分产品情况']] : []),
    ...(!hidden.has(REPORT_SECTION_TODO) ? [['report-v2-todo', '待办事项及进展']] : []),
    ...(model.kind === 'month' && !hidden.has(REPORT_SECTION_PREVIOUS_VISITS) ? [['report-v2-visits', '上期省代表回访结果补充']] : []),
    ...(!hidden.has(REPORT_SECTION_APPENDIX) ? [['report-v2-appendix', '附录']] : []),
  ], [model.kind, hidden])
  useEffect(() => {
    if (printAll || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => { for (const entry of entries) if (entry.isIntersecting) setActiveSection(entry.target.id) }, { rootMargin: '-96px 0px -60% 0px' })
    for (const [id] of sections) { const node = document.getElementById(id); if (node) observer.observe(node) }
    return () => observer.disconnect()
  }, [sections, printAll])
  const focus = model.focus.map((row) => actionValue(row, actionOverrides))
  const maxReason = Math.max(1, ...model.reasons.map((row) => row.count))
  const todoRows = todoItems
  const quarterMonths = model.kind === 'quarter' ? model.months : []
  const companyGap = model.kpis.avg == null || model.kpis.companyAvg == null ? null : roundDiff(model.kpis.avg, model.kpis.companyAvg)
  const previousGap = model.kpis.avg == null || model.kpis.previousAvg == null ? null : roundDiff(model.kpis.avg, model.kpis.previousAvg)
  const companyGapText = companyGap == null ? '公司无数据' : companyGap >= 0 ? `高于公司 ${number(companyGap)}` : `低于公司 ${number(Math.abs(companyGap))}`
  const periodChangeText = previousGap == null ? '—' : `${previousGap > 0 ? '+' : ''}${number(previousGap)}`
  const [overviewMinScore, overviewMaxScore] = scoreAxisDomain([...model.departmentTrend, ...model.companyTrend].map((row) => row.value))
  return <div className={`report-sheet-main report-v2 ${printAll ? 'report-v2--print' : ''}`}>
    <article className="report-modules">
      <section className="report-module v2-report-header"><h1>{model.title}</h1><p className="v2-subtle">数据周期：{model.months.map(monthLabel).join('—')} · 统计按导入月份归属</p>
        <div className="v2-summary"><span>部门均分 <b>{number(model.kpis.avg)}</b>（公司 {number(model.kpis.companyAvg)}；{companyGapText}；{model.kind === 'quarter' ? '较上季度' : '环比'} {periodChangeText}）</span><span>有效样本 <b>{model.kpis.totalSample}</b>（{model.kpis.productCount} 款产品）</span><span>9 分以下产品 <b>{model.kpis.belowNineCount}</b>（{model.kpis.belowNineNames.join('、') || '无'}）</span><span>投诉回访不达标 <b>{model.kpis.callbackUnqualifiedCount}</b></span>{model.kind === 'quarter' ? <span>月度走势 <QuarterTrendText rows={model.quarterMonthlyTrend} /></span> : null}</div>
      </section>
      <Section id="report-v2-overview" title={model.kind === 'quarter' ? '本季概述' : '本月概述'}>
        <div className="v2-focus"><h3>{model.kind === 'quarter' ? '本季关注' : '本月关注'}（按行动紧迫度排序）</h3>{focus.length ? focus.map((action) => <ActionItem key={action.id} action={action} overrides={actionOverrides} canEdit={canEdit} onActionChange={onActionChange} isFocus />) : <p>{model.kind === 'quarter' ? '本季' : '本月'}无需重点跟进事项</p>}{model.actions.filter((row) => row.priority === 'P0').length > 3 && !hidden.has(REPORT_SECTION_PRODUCTS) ? <p className="v2-subtle">其余 {model.actions.filter((row) => row.priority === 'P0').length - 3} 项见分产品建议举措</p> : null}</div>{model.kind === 'quarter' ? <p className="v2-quarter-change"><b>主要变化：</b>{model.quarterChange}</p> : null}
        <div className="post-use-html-report-kpis"><Metric label="部门均分（三渠道）" value={number(model.kpis.avg)} hint={<><span className={companyGap == null ? '' : companyGap >= 0 ? 'v2-ok' : 'v2-danger'}>{companyGapText}</span> · {model.kind === 'quarter' ? '较上季度' : '环比'} {periodChangeText}</>} tone={companyGap != null && companyGap >= 0 ? 'ok' : ''} /><Metric label="有效样本量" value={model.kpis.totalSample} hint={`涉及 ${model.kpis.productCount} 款产品`} /><Metric label="9 分以下产品数" value={model.kpis.belowNineCount} hint={model.kpis.belowNineNames.join('、') || '无'} tone={model.kpis.belowNineCount ? 'danger' : ''} /><Metric label="投诉回访不达标产品数" value={model.kpis.callbackUnqualifiedCount} hint={model.kpis.callbackUnqualifiedCount ? '需关注' : '全部达标'} tone={model.kpis.callbackUnqualifiedCount ? 'danger' : 'ok'} /></div>
        <div className="v2-chart-grid"><div className="v2-panel"><div className="page-card-header"><span className="page-card-title">部门与公司均分趋势</span></div><TrendSvg months={model.departmentTrend.map((row) => row.month)} series={[{ name: '部门', color: 'var(--v2-blue)', data: model.departmentTrend }, { name: '公司', color: 'var(--v2-warning)', data: model.companyTrend }]} min={overviewMinScore} max={overviewMaxScore} baseline={9} baselineLabel="关注线 9" quarterMonths={quarterMonths} compact /><p className="v2-subtle">另有「体验均分」（短信及控制台）口径，本期为 {number(model.kpis.experienceAvg)} 分；图中仅展示三渠道均分。</p></div><div className="v2-panel"><div className="page-card-header"><span className="page-card-title">投诉回访满意度（10 分满意度）</span></div><TrendSvg months={model.satisfactionTrend.map((row) => row.month)} series={[{ name: '10 分满意度', color: 'var(--v2-success)', data: model.satisfactionTrend }]} min={80} max={100} baseline={88} baselineLabel="达标线 88%" quarterMonths={quarterMonths} suffix="%" missingLabel="无工单" tickStep={5} compact /></div></div>
        <div className="v2-panel"><div className="page-card-header"><span className="page-card-title">部门低分原因汇总</span></div><div className="v2-table-scroll"><table className="v2-table"><thead><tr><th>原因归类</th><th>条数</th><th>最低分</th><th>涉及产品</th></tr></thead><tbody>{model.reasons.map((row) => <tr key={row.name} className={reasonRowClass(row)}><td className={row.type === 'ten-option' ? 'v2-option-text' : ''}>{row.name} {row.type === 'ten-option' ? tag('低风险', 'muted') : row.isNew ? tag('NEW', 'warning') : null}</td><td><Microbar count={row.count} max={maxReason} tone={row.type === 'ten-option' ? 'muted' : row.lowestScore <= 5 ? 'danger' : 'warning'} /></td><td className={row.type === 'low' && row.lowestScore <= 5 ? 'v2-danger' : ''}>{row.lowestScore}</td><td>{row.products.join('、')}</td></tr>)}</tbody></table></div><p className="v2-subtle">低分原因 ≤5 分共 {model.lowScoreRecordCount} 条评分记录。10 分反馈选项单列，不计入低分风险。有效正反馈 {model.positiveCount} 条，详见附录 D。</p></div>
      </Section>
      {!hidden.has(REPORT_SECTION_PRODUCTS) ? <Section id="report-v2-products" title="一、分产品情况"><div className="v2-product-layout"><nav className="v2-product-list" aria-label="产品列表">{model.products.map((product) => <button key={product.name} type="button" className={selectedProduct === product.name ? 'is-active' : ''} onClick={() => setSelectedProduct(product.name)}><span>{product.name}</span><b className={product.avg < 9 ? 'v2-danger' : ''}>{number(product.avg)}</b>{product.belowNine ? tag('低于9', 'danger') : product.status === '重点改善' ? tag('重点改善', 'danger') : null}</button>)}</nav><div className="v2-product-content">{model.products.map((product, index) => <div key={product.name} className={`v2-product-slot ${selectedProduct === product.name ? 'is-active' : ''}`}><ProductPanel product={product} index={index} model={model} printAll={printAll} issueNarratives={issueNarratives} onIssueChange={onIssueChange} actionOverrides={actionOverrides} onActionChange={onActionChange} canEdit={canEdit} /></div>)}</div></div></Section> : null}
      {!hidden.has(REPORT_SECTION_TODO) ? <Section id="report-v2-todo" title="二、待办事项及进展"><div className="v2-table-scroll"><table className="v2-table v2-todo-table"><thead><tr><th>序号</th><th>事项</th><th>责任人</th><th>班组</th><th>进展</th></tr></thead><tbody>{todoRows.map((row, index) => <tr key={row.id || index}><td>{index + 1}</td><td><b>【{row.productName || '待确认产品'}】</b>{row.content || row.text || '—'}</td><td>{row.owner || '待指派'}</td><td>{row.team || '—'}</td><td>{row.status || '待处理'}</td></tr>)}</tbody></table></div>{!todoRows.length ? <p className="v2-subtle">暂无待办事项</p> : null}<p className="v2-subtle">本期建议回访/溯源的反馈记录共 {model.recommendedFeedbackCount} 条；测试账号与 10 分反馈选项无需跟进，实际转为待办 {todoRows.length} 项（上表）。</p>{canEdit ? <details className="v2-edit no-print"><summary>编辑待办</summary><button type="button" onClick={() => onTodoItemsChange?.([...todoRows, { id: `todo-${Date.now()}`, productName: '', content: '', owner: '', team: '', status: '待处理' }])}>添加待办</button>{todoRows.map((row, index) => <div key={row.id || index} className="v2-edit-grid v2-edit-grid--todo"><input aria-label="产品" value={row.productName || ''} onChange={(event) => onTodoItemsChange?.(todoRows.map((item, i) => i === index ? { ...item, productName: event.target.value } : item))} /><input aria-label="事项" value={row.content || ''} onChange={(event) => onTodoItemsChange?.(todoRows.map((item, i) => i === index ? { ...item, content: event.target.value } : item))} /><input aria-label="责任人" value={row.owner || ''} onChange={(event) => onTodoItemsChange?.(todoRows.map((item, i) => i === index ? { ...item, owner: event.target.value } : item))} /><input aria-label="班组" value={row.team || ''} onChange={(event) => onTodoItemsChange?.(todoRows.map((item, i) => i === index ? { ...item, team: event.target.value } : item))} /><input aria-label="进展" value={row.status || ''} onChange={(event) => onTodoItemsChange?.(todoRows.map((item, i) => i === index ? { ...item, status: event.target.value } : item))} /><button type="button" onClick={() => onTodoItemsChange?.(todoRows.filter((_, i) => i !== index))}>删除</button></div>)}</details> : null}</Section> : null}
      {model.kind === 'month' && !hidden.has(REPORT_SECTION_PREVIOUS_VISITS) ? <Section id="report-v2-visits" title="三、上期省代表回访结果补充"><div className="v2-table-scroll"><table className="v2-table"><thead><tr><th>客户</th><th>省代表回访记录</th><th>回访结果内部评估/回应</th><th>结论分类</th></tr></thead><tbody>{model.previousVisits.map((row) => <tr key={row.id}><td>{mask(row.customerName)}</td><td>{row.visitResult || '—'}</td><td>{row.internalConclusion || '—'}</td><td>{tag(row.category, row.category === '专项优化' ? 'warning' : row.category === '无需优改' ? 'ok' : 'muted')}</td></tr>)}</tbody></table></div>{!model.previousVisits.length ? <p className="v2-subtle">上期无省代表回访记录</p> : <p className="v2-subtle">{model.previousVisits.length} 条上期回访中：无需行动 {model.previousVisits.filter((row) => row.category === '无需优改').length} 条、专项优化跟进 {model.previousVisits.filter((row) => row.category === '专项优化').length} 条。</p>}</Section> : null}
      {!hidden.has(REPORT_SECTION_APPENDIX) ? <Section id="report-v2-appendix" title={`${model.kind === 'month' ? '四' : '三'}、附录`}><details className="v2-details" open={printAll || undefined}><summary>附录 A：整体得分表</summary><div className="v2-table-scroll"><table className="v2-table"><thead><tr><th>产品</th><th>样本量</th><th>均分</th><th>投诉回访10分满意度</th></tr></thead><tbody>{model.products.map((row) => <tr key={row.name} className={row.belowNine ? 'v2-row-danger' : ''}><td>{row.name}</td><td>{row.sample}</td><td>{number(row.avg)}</td><td>{callbackDisplay(row, model.kind, model.months)}</td></tr>)}</tbody></table></div></details><details className="v2-details" open={printAll || undefined}><summary>附录 B：评分分布{model.kind === 'quarter' ? '与月度均分分解' : ''}</summary><div className="v2-table-scroll"><table className="v2-table"><thead><tr><th>产品</th><th>样本</th>{Array.from({ length: 10 }, (_, index) => <th key={index}>{10 - index}分</th>)}</tr></thead><tbody>{model.products.map((row) => row.sample === 1 ? <tr key={row.name}><td>{row.name}</td><td colSpan={11}>样本 1 · 全部为 {Object.entries(row.distribution).find(([, count]) => count === 1)?.[0] || '—'} 分</td></tr> : <tr key={row.name}><td>{row.name}</td><td>{row.sample}</td>{Array.from({ length: 10 }, (_, index) => <td key={index}>{row.distribution[String(10 - index)]}</td>)}</tr>)}</tbody></table></div>{model.kind === 'quarter' ? <div className="v2-table-scroll"><table className="v2-table"><thead><tr><th>产品</th>{model.months.map((month) => <th key={month}>{monthLabel(month)}</th>)}</tr></thead><tbody>{model.products.map((row) => <tr key={row.name}><td>{row.name}</td>{row.monthly.map((item) => <td key={item.month}>{item.sample ? `${number(item.value)}（${item.sample} 条）` : '无样本'}</td>)}</tr>)}</tbody></table></div> : null}</details><details className="v2-details" open={printAll || undefined}><summary>附录 C：客户明细</summary><div className="v2-table-scroll"><table className="v2-table"><thead><tr><th>客户</th><th>编码</th><th>产品</th><th>非10分</th><th>均分</th><th>最近原话</th></tr></thead><tbody>{model.customers.map((row, index) => <tr key={index}><td>{mask(row.customerName)}</td><td>{mask(row.customerCode)}</td><td>{(row.products || []).join('、')}</td><td>{row.nonTenCount}</td><td>{number(row.avgScore)}</td><td>{isValidCustomerText(row.latestQuote) ? row.latestQuote : '—'}</td></tr>)}</tbody></table></div></details><details className="v2-details" open={printAll || undefined}><summary>附录 D：有效客户原话登记</summary><div className="v2-table-scroll"><table className="v2-table"><thead><tr><th>渠道</th><th>正负</th><th>类型</th><th>产品</th><th>得分</th><th>客户</th><th>时间</th><th>原文</th></tr></thead><tbody>{model.quoteRegistry.map((row, index) => <tr key={`${row.recordId}-${index}`}><td>{row.channelLabel}</td><td>{reportV2QuoteCategory(row)}</td><td>{row.kind === 'option' ? '反馈选项' : '客户原话'}</td><td>{row.productName}{row.sourceProductName && row.sourceProductName !== row.productName ? `（${row.sourceProductName}规格）` : ''}</td><td>{row.score == null ? '—' : row.score}</td><td>{mask(row.customerName || row.customerCode)}</td><td>{row.answeredAt}</td><td>{row.text}</td></tr>)}</tbody></table></div></details><SharedBandwidthAppendix model={model} printAll={printAll} /></Section> : null}
    </article>
    {!printAll ? <nav className="report-toc v2-toc no-print" aria-label="报告目录"><ul className="report-toc__list">{sections.map(([id, label]) => <li key={id}><a href={`#${id}`} className={activeSection === id ? 'is-active' : ''} onClick={(event) => { event.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }}>{label}</a>{id === 'report-v2-products' ? <ul className="report-toc__sublist">{model.products.map((row) => <li key={row.name}><a href="#report-v2-products" className={selectedProduct === row.name ? 'is-active' : ''} onClick={(event) => { event.preventDefault(); setSelectedProduct(row.name); document.getElementById('report-v2-products')?.scrollIntoView({ behavior: 'smooth' }) }}>{row.name}</a></li>)}</ul> : null}</li>)}</ul></nav> : null}
  </div>
}

function roundDiff(current, previous) {
  return Math.round((Number(current) - Number(previous)) * 100) / 100
}
