import { buildCustomerQuoteRegistry, isPraiseQuote } from './customerQuotes.js'
import { buildReportIssueOccurrences, resolveReportIssues } from './reportEvidence.js'
import { isSubstantiveFeedbackReason, REASON_TAXONOMY_EXCLUDE } from './reasonTaxonomy.js'
import { postUsePeriodMonths } from './periodScope.js'
import { computeInternalSatisfactionMetrics } from './metrics.js'
import { postUseRecordsToScoredRows } from './scoredRows.js'
import { buildCustomerInsights } from './insights.js'

const SCORE_BASELINE = 9
const REPORT_PRODUCT_ALIASES = new Map([['共享带宽', '弹性公网IP']])

/** A selected option is not customer praise, even if its text is “满意”. */
export function isReportV2PraiseQuote(quote) {
  if (!quote || quote.channel === 'option' || quote.kind === 'option') return false
  // The 2026-10 prototype registers the courteous 10-point reply “需订购其他服务，谢谢！” as praise.
  return isPraiseQuote(quote)
    || (quote.polarity === 'positive' && Number(quote.score) === 10 && /谢谢/.test(String(quote.text || '')))
}

export function reportV2QuoteCategory(quote) {
  if (quote?.score == null && /^(?:业务)?使用完毕(?:无后续使用需求)?$/.test(String(quote.text || '').trim())) return '中性备注'
  if (quote?.score == null && !isSubstantiveFeedbackReason(String(quote.text || '').trim())) return '中性备注'
  if (quote?.kind === 'option') return Number(quote.score) === 10 ? '反馈选项' : '负反馈'
  if (isReportV2PraiseQuote(quote)) return '正反馈'
  if (quote?.score == null && /^(?:已|已经|现已|目前已)/.test(String(quote.text || ''))
    && !/不|无|未|缺|故障|问题|慢|差|失败|投诉/.test(String(quote.text || ''))) return '中性备注'
  return quote?.polarity === 'positive' ? '中性备注' : '负反馈'
}

function productOf(record) {
  const name = String(record?.product || record?.productName || '').trim()
  return REPORT_PRODUCT_ALIASES.get(name) || name
}

function sourceProductOf(record) {
  return String(record?.sourceProductName || record?.evidence?.productName || '').trim()
}

function monthOf(record) {
  return String(record?.importMonth || '').slice(0, 7)
}

function scoreOf(record) {
  const value = Number(record?.ratingScore)
  return record?.ratingScore == null || !Number.isFinite(value) ? null : value
}

function isScored(record) {
  return record?.dataSourceType === 'post_use_rating'
    && record?.channel !== 'option'
    && record?.sourceSubType !== 'web_option'
    && scoreOf(record) != null
}

function average(rows) {
  if (!rows.length) return null
  return Math.round(rows.reduce((sum, row) => sum + Number(row.score ?? scoreOf(row) ?? 0), 0) / rows.length * 100) / 100
}

function round(value) {
  return Math.round(value * 100) / 100
}

function distinct(items) {
  return [...new Set(items.filter(Boolean))]
}

function v2QuoteKind(item, source) {
  if (item.channel !== 'option') return item.kind
  if (Number(item.score) === 10) return 'option'
  const comment = String(source?.commentText || '').trim()
  return comment && comment.includes(String(item.text || '')) ? 'quote' : 'option'
}

function reportQuotes(records) {
  const sourceById = new Map(records.map((record) => [String(record.id || ''), record]))
  return buildCustomerQuoteRegistry(records).map((quote) => {
    const source = sourceById.get(quote.recordId)
    return {
      ...quote,
      kind: v2QuoteKind(quote, source),
      productName: productOf(source),
      importMonth: monthOf(source),
      sourceProductName: sourceProductOf(source),
    }
  })
}

function previousMonths(months, kind) {
  const first = months[0]
  if (!first) return []
  const [year, month] = first.split('-').map(Number)
  const count = kind === 'quarter' ? 3 : 1
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - count + index, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

function monthRange(endMonth, count) {
  if (!/^\d{4}-\d{2}$/.test(endMonth)) return []
  const [year, month] = endMonth.split('-').map(Number)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - count + index, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

function scoreDistribution(rows) {
  const distribution = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(10 - index), 0]))
  for (const row of rows) {
    const score = Math.round(Number(row.score ?? scoreOf(row)))
    if (Number.isInteger(score) && score >= 1 && score <= 10) distribution[String(score)] += 1
  }
  return distribution
}

function callbackRate(rows) {
  const callback = rows.filter((row) => row.channel === 'callback' || row.sourceSubType === 'satisfaction_callback')
  return callback.length ? round(callback.filter((row) => Number(row.score ?? scoreOf(row)) === 10).length / callback.length * 100) : null
}

function trendFromRecords(rows, months, productName = '') {
  return months.map((month) => {
    const selected = rows.filter((row) => monthOf(row) === month && (!productName || productOf(row) === productName))
    return { month, value: average(selected), sample: selected.length }
  })
}

function productTrend(allRows, months, productName, productScores) {
  const remote = new Map()
  for (const row of productScores || []) {
    const sample = Number(row.sampleSize) || 0
    const score = Number(row.avgScore)
    if (productOf(row) !== productName || sample <= 0 || !Number.isFinite(score)) continue
    const prev = remote.get(row.date) || { total: 0, sample: 0 }
    remote.set(row.date, { total: prev.total + score * sample, sample: prev.sample + sample })
  }
  const byMonth = new Map([...remote].map(([month, row]) => [month, {
    month, value: round(row.total / row.sample), sample: row.sample,
  }]))
  for (const row of trendFromRecords(allRows, months, productName)) {
    if (row.sample) byMonth.set(row.month, row)
  }
  return months.map((month) => byMonth.get(month) || { month, value: null, sample: 0 })
}

function lifecycle(monthCounts, months) {
  const counts = months.map((month) => monthCounts[month] || 0)
  const active = counts.filter(Boolean).length
  if (!active) return ''
  if (counts.at(-1) === 0 && counts.slice(0, -1).some(Boolean)) return '已收敛（末月无）'
  if (active === months.length) return '贯穿全季'
  if (active === 1) return `单月（${Number(months[counts.findIndex(Boolean)].slice(5))}月）`
  const max = Math.max(...counts)
  const peak = counts.indexOf(max)
  if (max >= 2 * (counts.reduce((sum, value) => sum + value, 0) - max)) {
    return `${Number(months[peak].slice(5))}月集中爆发`
  }
  return ''
}

function themeRows(records, allRecords, visits, traces, links, months, earlierMonths, kind) {
  const relevant = new Set([...months, ...earlierMonths])
  const issues = resolveReportIssues(
    buildReportIssueOccurrences(allRecords.filter((record) => relevant.has(monthOf(record)))),
    visits, traces, links,
  )
  const sourceById = new Map(allRecords.map((record) => [String(record.id || ''), record]))
  const current = new Set(months)
  const previous = new Set(earlierMonths)
  const grouped = new Map()
  const previousCounts = new Map()
  for (const issue of issues) {
    if (issue.status === 'excluded_no_issue' || REASON_TAXONOMY_EXCLUDE.has(issue.issueName)) continue
    const score = issue.score == null ? null : Number(issue.score)
    const issueKind = v2QuoteKind(issue, sourceById.get(issue.recordId))
    const isTenOption = issueKind === 'option' && score === 10
    const isLow = score != null && Number.isFinite(score) && score >= 1 && score < 10
      && (issueKind === 'option' || reportV2QuoteCategory({ ...issue, kind: issueKind }) === '负反馈')
      && isSubstantiveFeedbackReason(issue.issueName)
    if (!isTenOption && !isLow) continue
    const productName = REPORT_PRODUCT_ALIASES.get(issue.productName) || issue.productName
    const key = `${productName}\0${isTenOption ? 'ten-option' : 'low'}\0${issue.issueName}`
    if (previous.has(issue.month)) {
      const ids = previousCounts.get(key) || new Set()
      ids.add(issue.recordId)
      previousCounts.set(key, ids)
    }
    if (!current.has(issue.month)) continue
    const row = grouped.get(key) || {
      key, productName, theme: issue.issueName, type: isTenOption ? 'ten-option' : 'low',
      lowestScore: null, recordIds: new Set(), pieceIds: new Set(), customerKeys: new Set(),
      monthRecordIds: new Map(), occurrences: [],
    }
    row.recordIds.add(issue.recordId)
    row.pieceIds.add(issue.pieceId)
    row.customerKeys.add(issue.customerCode || issue.customerName || issue.recordId)
    const monthSet = row.monthRecordIds.get(issue.month) || new Set()
    monthSet.add(issue.recordId)
    row.monthRecordIds.set(issue.month, monthSet)
    row.lowestScore = row.lowestScore == null ? score : Math.min(row.lowestScore, score)
    row.occurrences.push({ ...issue, kind: issueKind })
    grouped.set(key, row)
  }
  return [...grouped.values()].map((row) => {
    const monthCounts = Object.fromEntries(months.map((month) => [month, row.monthRecordIds.get(month)?.size || 0]))
    const life = kind === 'quarter' ? lifecycle(monthCounts, months) : ''
    const previousCount = previousCounts.get(row.key)?.size || 0
    const linkedVisitIds = distinct(row.occurrences.flatMap((item) => item.linkedVisitIds || []))
    const linkedVisits = visits.filter((visit) => linkedVisitIds.includes(String(visit.id)))
    const dissatisfied = linkedVisits.some((visit) =>
      /不满|未解决|仍有问题|需要优化/.test(String(visit.visitResult || visit.visitFeedbackDetail || '')))
    const nonActionable = (linkedVisits.length > 0 && linkedVisits.every((visit) => ['无法回访', '已清退'].includes(visitCategory(visit))))
      || row.occurrences.every((item) => /测试账号|测试用户/.test(String(item.customerName || '')))
    const consecutive = kind === 'month' && previousCount > 0
    let priority = 'P2'
    if (row.type === 'low' && (dissatisfied || (row.lowestScore <= 5 && isSubstantiveFeedbackReason(row.theme)) || consecutive)) priority = 'P0'
    else if (row.type === 'low' && row.lowestScore <= 8) priority = 'P1'
    if (kind === 'quarter') {
      if (life.startsWith('已收敛')) priority = 'P2'
      else if (life === '贯穿全季' && row.lowestScore <= 5) priority = 'P0'
      else if (life.includes('集中爆发') && row.lowestScore <= 5) priority = 'P0'
    }
    if (nonActionable) priority = 'P2'
    return {
      key: row.key, productName: row.productName, theme: row.theme, type: row.type,
      count: row.recordIds.size, segmentCount: row.pieceIds.size, customerCount: row.customerKeys.size,
      lowestScore: row.lowestScore, monthCounts,
      monthRecordIds: Object.fromEntries(months.map((month) => [month, [...(row.monthRecordIds.get(month) || [])]])),
      lifecycle: life, priority,
      isNew: previousCount === 0, previousCount, dissatisfied, nonActionable,
      recordIds: [...row.recordIds], customerKeys: [...row.customerKeys],
      linkedTraceIds: distinct(row.occurrences.flatMap((item) => item.linkedTraceIds || [])),
      linkedVisitIds,
      quotes: distinct(row.occurrences.filter((item) => item.kind === 'quote').map((item) => item.text)).slice(0, 3),
    }
  }).sort((a, b) => ({ P0: 0, P1: 1, P2: 2 }[a.priority] - { P0: 0, P1: 1, P2: 2 }[b.priority])
    || a.lowestScore - b.lowestScore || b.count - a.count || a.theme.localeCompare(b.theme, 'zh'))
}

function visitCategory(visit) {
  const text = [visit.visitResult, visit.internalConclusion, visit.internalEvaluationDetail].filter(Boolean).join(' ')
  if (/清退/.test(text)) return '已清退'
  if (/无法回访|联系不上|未接通/.test(text)) return '无法回访'
  if (/专项优化|需要优化|待优化/.test(text)) return '专项优化'
  if (/无实际不满|无问题|无需优改|无需优化/.test(text)) return '无需优改'
  return '待核实'
}

function previousVisitRows(visits, reportKey) {
  const previousMonth = previousMonths([reportKey], 'month')[0]
  return visits.filter((visit) => (visit.importMonth || visit.visitMonth) === previousMonth)
    .map((visit) => {
      const customerName = String(visit.customerName || visit.userInfoDetail || visit.userInfo || '').trim() || '未标注客户'
      const visitResult = String(visit.visitResult || visit.visitFeedbackDetail || visit.feedbackSummary || '').trim()
      return {
        id: String(visit.id || `${customerName}-${productOf(visit)}-${visitResult}`),
        customerName,
        productName: productOf(visit),
        visitResult,
        internalConclusion: String(visit.internalConclusion || visit.internalEvaluationDetail || '').trim(),
        remark: String(visit.remark || '').trim(),
        category: visitCategory(visit),
      }
    })
}

function focusActionType(row, trace, visit) {
  if (row.dissatisfied || (visit && /不满|未解决|仍有问题|还没改/.test(String(visit.visitResult || visit.visitFeedbackDetail || '')))) return '回访跟进'
  if (/故障|不通|稳定性|网络质量|卡单|缺陷/.test(`${row.theme} ${trace?.recommendedReason || ''}`)) return '缺陷修复'
  if (/功能|能力|接口|API|配置|批量|指标|诉求|界面|布局|体验|操作/.test(row.theme)) return '诉求闭环'
  if (/回访/.test(String(trace?.recommendedReason || ''))) return '回访跟进'
  return '回访跟进'
}

function focusFacts(row, trace, visit, months, kind, visitInferred = false, backgroundTrace = null) {
  const facts = []
  const visitText = String(visit?.visitResult || visit?.visitFeedbackDetail || '').trim()
  if (visitText) facts.push(`${visitInferred ? '同客户省代表回访' : '省代表回访'}：「${visitText.slice(0, 100)}」`)
  const traceText = String(trace?.recommendedReason || trace?.progress || '').trim()
  if (traceText) facts.push(`产品部溯源：${traceText.slice(0, 140)}`)
  const backgroundText = String(backgroundTrace?.recommendedReason || backgroundTrace?.progress || '').trim()
  if (!traceText && backgroundText) facts.push(`产品部溯源背景：${backgroundText.slice(0, 140)}`)
  if (!visitText && row.quotes[0]) facts.push(`客户原话：「${row.quotes[0].slice(0, 100)}」`)
  if (kind === 'quarter') facts.push(`月度分布：${months.map((month) => `${Number(month.slice(5))}月 ${row.monthCounts[month] || 0} 条`).join('、')}`)
  else if (row.previousCount) facts.push(`上期 ${row.previousCount} 条，本期 ${row.count} 条`)
  return facts.join('；') || `本期关联 ${row.count} 条评分记录，最低 ${row.lowestScore} 分。`
}

function inferVisitForTheme(row, themes, visits) {
  const candidates = visits.filter((visit) => {
    const customer = String(visit.customerCode || visit.customerName || '').trim()
    const visitMonths = String(visit.importMonth || visit.visitMonth || '').split('、').map((month) => month.trim())
    if (!customer || productOf(visit) !== row.productName || !row.customerKeys.includes(customer)
      || !visitMonths.some((month) => row.monthCounts[month] > 0)) return false
    const relatedRecords = distinct(themes.filter((theme) => theme.productName === row.productName
      && theme.customerKeys.includes(customer)
      && visitMonths.some((month) => theme.monthCounts[month] > 0)).flatMap((theme) => theme.recordIds))
    return relatedRecords.length === 1 && row.recordIds.includes(relatedRecords[0])
  })
  return candidates.length === 1 ? candidates[0] : null
}

function actionRows(themes, traces, visits, actions, months, kind) {
  return themes.filter((row) => row.type === 'low').map((row) => {
    const linkedTraceIds = new Set(row.linkedTraceIds || [])
    const matchingTraces = traces.filter((item) => linkedTraceIds.has(String(item.id)))
    const traceOwners = distinct(matchingTraces.map((item) => String(item.assigneeName || '').trim()))
    const trace = matchingTraces.length === 1 ? matchingTraces[0] : null
    const periodTraces = traces.filter((item) => productOf(item) === row.productName
      && String(item.importMonth || '').split('、').some((month) => months.includes(month.trim())))
    const backgroundTrace = !trace && periodTraces.length === 1 ? periodTraces[0] : null
    const linkedVisitIds = new Set(row.linkedVisitIds || [])
    const matchingVisits = visits.filter((item) => linkedVisitIds.has(String(item.id)))
    const directVisit = matchingVisits.length === 1 ? matchingVisits[0] : null
    const visit = directVisit || inferVisitForTheme(row, themes, visits)
    const visitInferred = Boolean(visit && !directVisit)
    const customerDissatisfied = row.dissatisfied || Boolean(visit && /不满|未解决|仍有问题|还没改/.test(String(visit.visitResult || visit.visitFeedbackDetail || '')))
    const recordIds = new Set(row.recordIds)
    const action = actions.find((item) => productOf(item) === row.productName
      && item.linkedDataSources?.includes('post_use_rating')
      && item.evidenceRecordIds?.some((id) => recordIds.has(String(id))))
    const verb = row.nonActionable ? '无法回访，无需跟进'
      : row.priority === 'P2' ? '纳入常规运营关注，下期仅观察计数变化，不单独推动'
      : row.lifecycle.startsWith('已收敛') ? '下季度验证问题是否持续收敛'
        : trace?.recommendedReason || action?.content
          || (row.lifecycle === '贯穿全季' ? `治理「${row.theme}」的根因并复核效果`
            : row.lifecycle.includes('集中爆发') ? `定位「${row.theme}」集中月份的事件并明确治理时点`
              : row.lifecycle.startsWith('单月') ? `回访核实「${row.theme}」并观察是否再现`
                : `核查「${row.theme}」并明确处理结论`)
    const actionType = focusActionType(row, trace || backgroundTrace, visit)
    const severity = `${row.count} 条，最低 ${row.lowestScore} 分`
    const title = customerDissatisfied
      ? `${row.productName}「${row.theme}」客户回访明确不满，需跟进回应`
      : kind === 'quarter' && row.lifecycle
        ? `${row.productName}「${row.theme}」${row.lifecycle}（${severity}），需${actionType === '缺陷修复' ? '定位并修复' : '回应诉求'}`
        : `${row.productName}「${row.theme}」${row.previousCount ? '连续两期出现，' : ''}本期 ${severity}，需${actionType === '缺陷修复' ? '定位修复' : '明确处理结论'}`
    return {
      id: row.key, productName: row.productName, theme: row.theme, priority: row.priority,
      lifecycle: row.lifecycle, text: String(verb).trim(), actionType, title,
      detail: focusFacts(row, trace, visit, months, kind, visitInferred, backgroundTrace),
      customerDissatisfied,
      isNew: row.isNew, previousCount: row.previousCount, lowestScore: row.lowestScore,
      owner: traceOwners.length === 1 ? traceOwners[0] : '',
      team: String(action?.team || '').trim(), status: String(action?.status || trace?.status || '待处理'),
      check: row.priority === 'P2' ? '下期观察同类反馈计数' : '复核客户反馈及后续评分',
      sourceRecordCount: row.count, recordIds: row.recordIds,
    }
  })
}

function selectFocus(actions, kind, products) {
  const belowNine = new Set(products.filter((row) => row.belowNine).map((row) => row.name))
  const rank = (row) => {
    if (row.customerDissatisfied) return 0
    if (kind === 'quarter' && row.lifecycle?.includes('集中爆发')) return 1
    if (kind === 'quarter' && row.lifecycle === '贯穿全季') return 2
    if (kind === 'month' && row.previousCount) return 1
    return 3
  }
  const ordered = actions.filter((row) => row.priority === 'P0')
    .sort((a, b) => rank(a) - rank(b)
      || Number(belowNine.has(b.productName)) - Number(belowNine.has(a.productName))
      || b.sourceRecordCount - a.sourceRecordCount)
  const selected = []
  const selectedProducts = new Set()
  for (const row of ordered) {
    if (selectedProducts.has(row.productName)) continue
    selected.push(row)
    selectedProducts.add(row.productName)
    if (selected.length === 3) return selected
  }
  for (const row of ordered) {
    if (selected.some((item) => item.id === row.id)) continue
    selected.push(row)
    if (selected.length === 3) break
  }
  return selected
}

function capActionsByProduct(actions, focus) {
  const focusIds = new Set(focus.map((row) => row.id))
  const grouped = new Map()
  for (const action of actions) {
    const list = grouped.get(action.productName) || []
    list.push(action)
    grouped.set(action.productName, list)
  }
  const result = []
  for (const [productName, rows] of grouped) {
    if (rows.length <= 5) {
      result.push(...rows)
      continue
    }
    const keep = rows.filter((row) => focusIds.has(row.id))
    for (const row of rows) {
      if (keep.length >= 4) break
      if (!focusIds.has(row.id)) keep.push(row)
    }
    const keptIds = new Set(keep.map((row) => row.id))
    const rest = rows.filter((row) => !keptIds.has(row.id))
    const priority = rest.find((row) => row.priority === 'P0') ? 'P0'
      : rest.find((row) => row.priority === 'P1') ? 'P1' : 'P2'
    const recordIds = distinct(rest.flatMap((row) => row.recordIds || []))
    const themes = distinct(rest.map((row) => row.theme))
    const owners = distinct(rest.map((row) => row.owner))
    const teams = distinct(rest.map((row) => row.team))
    const text = priority === 'P2'
      ? '纳入常规运营关注，下期仅观察计数变化，不单独推动'
      : `合并核查「${themes.slice(0, 2).join('」「')}」等 ${themes.length} 类问题，逐项明确处理结论`
    let hash = 2166136261
    for (const char of rest.map((row) => row.id).join('|')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    const merged = {
      id: `merged:${productName}:${(hash >>> 0).toString(36)}`,
      productName, theme: `其他 ${themes.length} 类问题`, priority,
      text, owner: owners.length === 1 ? owners[0] : '',
      team: teams.length === 1 ? teams[0] : '',
      status: '待处理', check: priority === 'P2' ? '下期观察同类反馈计数' : '逐项复核客户反馈及后续评分',
      sourceRecordCount: recordIds.length, recordIds,
      mergedThemeCount: themes.length,
    }
    result.push(...[...keep, merged].sort((a, b) => ({ P0: 0, P1: 1, P2: 2 }[a.priority] - { P0: 0, P1: 1, P2: 2 }[b.priority])))
  }
  return result
}

function dataFingerprint(model) {
  const facts = JSON.stringify([
    model.reportKey, model.kpis, model.products.map((row) => [
      row.name, row.sample, row.avg, row.distribution,
      row.sourceSpecRecords.map((source) => [source.recordId, source.sourceProductName]),
    ]),
    model.themes.map((row) => [row.key, row.count, row.lowestScore, row.monthCounts]),
    model.positiveCount,
    model.actions.map((row) => [row.id, row.text, row.title, row.detail, row.owner, row.status]),
    model.previousVisits.map((row) => [row.id, row.visitResult, row.internalConclusion]),
  ])
  let hash = 2166136261
  for (let index = 0; index < facts.length; index += 1) hash = Math.imul(hash ^ facts.charCodeAt(index), 16777619)
  return `v2:${(hash >>> 0).toString(36)}`
}

/** Build one factual model for online display, offline HTML and print. */
export function buildPostUseReportV2Model({ reportKey, reportKind, reportPeriod, records = [], companyRecords = [], allRecords = [], allCompanyRecords = [], visits = [], traces = [], issueLinks = [], actionItems = [], statusTrends = null, overlay = null }) {
  const kind = reportKind === 'quarter' ? 'quarter' : 'month'
  const months = postUsePeriodMonths(reportPeriod)
  const monthSet = new Set(months)
  const previous = previousMonths(months, kind)
  const currentScored = records.filter(isScored)
  const companyScored = companyRecords.filter(isScored)
  const historyScored = allRecords.filter(isScored)
  const companyHistory = allCompanyRecords.filter(isScored)
  const groups = new Map()
  for (const row of currentScored) {
    const name = productOf(row)
    const list = groups.get(name) || []
    list.push(row)
    groups.set(name, list)
  }
  const recordsByProduct = new Map()
  for (const row of records) {
    const name = productOf(row)
    const list = recordsByProduct.get(name) || []
    list.push(row)
    recordsByProduct.set(name, list)
  }
  const sourceSpecsByProduct = new Map()
  for (const row of records) {
    const name = productOf(row)
    const sourceProductName = sourceProductOf(row)
    if (!sourceProductName || sourceProductName === name) continue
    const list = sourceSpecsByProduct.get(name) || []
    list.push({
      recordId: String(row.id || ''),
      sourceProductName,
      importMonth: monthOf(row),
      score: isScored(row) ? scoreOf(row) : null,
      channel: row.channel || '',
      answeredAt: row.createdAt || '',
      customerName: row.customerName || '',
      customerCode: row.customerCode || '',
      countedInScore: isScored(row),
    })
    sourceSpecsByProduct.set(name, list)
  }
  const themes = themeRows(currentScored, allRecords, visits, traces, issueLinks, months, previous, kind)
  const reportVisits = visits.filter((row) => monthSet.has(row.importMonth || row.visitMonth))
  const productNames = [...groups.keys()]
  const productTrendMonths = monthRange(months.at(-1) || '', kind === 'quarter' ? 14 : 5)
  const overviewTrendMonths = monthRange(months.at(-1) || '', 6)
  const products = productNames.map((name) => {
    const rows = groups.get(name) || []
    const scores = rows.map((row) => Number(scoreOf(row)))
    const productThemes = themes.filter((row) => row.productName === name)
    const previousRows = historyScored.filter((row) => previous.includes(monthOf(row)) && productOf(row) === name)
    const quotes = reportQuotes(recordsByProduct.get(name) || [])
    const positive = quotes.filter(isReportV2PraiseQuote)
    const neutralCount = quotes.filter((quote) => reportV2QuoteCategory(quote) === '中性备注').length
    const sourceSpecRecords = sourceSpecsByProduct.get(name) || []
    const sample = rows.length
    const avg = average(rows)
    const hasQuote = productThemes.some((row) => row.quotes.length)
    const smallQuarterSample = kind === 'quarter' && sample < 5 && !hasQuote
    const belowNine = avg != null && avg < SCORE_BASELINE && !smallQuarterSample
    const status = belowNine || productThemes.some((row) => row.priority === 'P0') ? '重点改善' : '持续观察'
    return {
      name, sample, avg, previousSample: previousRows.length, previousAvg: average(previousRows),
      previousLowThree: previousRows.filter((row) => scoreOf(row) <= 3).length,
      nonTen: scores.filter((score) => score !== 10).length,
      lowThree: scores.filter((score) => score <= 3).length,
      distribution: scoreDistribution(rows),
      callbackRate: callbackRate(rows),
      belowNine, smallQuarterSample, status, themes: productThemes,
      monthly: productTrend(historyScored, months, name, statusTrends?.productScores),
      trend: productTrend(historyScored, productTrendMonths, name, statusTrends?.productScores),
      nonTenMonths: distinct(rows.filter((row) => scoreOf(row) !== 10).map(monthOf)),
      lowThreeMonths: distinct(rows.filter((row) => scoreOf(row) <= 3).map(monthOf)),
      callbackMonths: distinct(rows.filter((row) => row.channel === 'callback' || row.sourceSubType === 'satisfaction_callback').map(monthOf)),
      quotes, positive: positive.slice(0, 3), positiveCount: positive.length, neutralCount,
      sourceSpecRecords,
      visits: reportVisits.filter((row) => productOf(row) === name),
      traces: traces.filter((row) => productOf(row) === name && String(row.importMonth || '').split('、').some((month) => monthSet.has(month.trim()))),
    }
  }).sort((a, b) => Number(b.belowNine) - Number(a.belowNine)
    || Number(b.status === '重点改善') - Number(a.status === '重点改善')
    || b.sample - a.sample || a.name.localeCompare(b.name, 'zh'))
  const rawActions = actionRows(themes, traces, visits, actionItems, months, kind)
  const focus = selectFocus(rawActions, kind, products)
  const allActions = capActionsByProduct(rawActions, focus)
  const registry = reportQuotes(records)
  const positiveRegistry = registry.filter(isReportV2PraiseQuote)
  const reasonsMap = new Map()
  for (const row of themes) {
    const key = row.type === 'ten-option' ? '10 分反馈选项类' : row.theme
    const entry = reasonsMap.get(key) || { name: key, count: 0, lowestScore: null, products: new Set(), type: row.type, isNew: false }
    entry.count += row.count
    entry.lowestScore = entry.lowestScore == null ? row.lowestScore : Math.min(entry.lowestScore, row.lowestScore)
    entry.products.add(row.productName)
    entry.isNew ||= row.isNew
    reasonsMap.set(key, entry)
  }
  const reasons = [...reasonsMap.values()].map((row) => ({ ...row, products: [...row.products] }))
    .sort((a, b) => Number(a.type === 'ten-option') - Number(b.type === 'ten-option')
      || a.lowestScore - b.lowestScore || b.count - a.count)
  const avg = average(currentScored)
  const companyAvg = average(companyScored)
  const previousAvg = average(historyScored.filter((row) => previous.includes(monthOf(row))))
  const publishedStatus = new Map((statusTrends?.combined?.data || []).map((row) => [row.date, row]))
  const departmentTrend = overviewTrendMonths.map((month) => {
    const row = publishedStatus.get(month)
    return { month, value: row?.department ?? trendFromRecords(historyScored, [month])[0]?.value ?? null }
  })
  const companyTrend = overviewTrendMonths.map((month) => {
    const row = publishedStatus.get(month)
    return { month, value: row?.company ?? trendFromRecords(companyHistory, [month])[0]?.value ?? null }
  })
  const satisfactionMonths = overviewTrendMonths.map((month) => {
    const selected = historyScored.filter((row) => monthOf(row) === month)
    const rate = publishedStatus.get(month)?.departmentRate ?? callbackRate(selected)
    return { month, value: rate }
  })
  const quarterMonthlyTrend = months.map((month) => departmentTrend.find((row) => row.month === month)
    || { month, value: trendFromRecords(historyScored, [month])[0]?.value ?? null })
  const quarterLow = quarterMonthlyTrend.filter((row) => row.value != null)
    .sort((a, b) => a.value - b.value)[0] || null
  const quarterChange = kind === 'quarter'
    ? (() => {
      const important = themes.find((row) => row.lifecycle.includes('集中爆发'))
        || themes.find((row) => row.lifecycle === '贯穿全季')
        || themes.find((row) => row.lifecycle.startsWith('已收敛'))
      if (important) return `${important.productName}「${important.theme}」在${important.lifecycle}，${important.priority === 'P0' ? '需优先核查。' : '建议持续观察。'}`
      return quarterLow ? `${Number(quarterLow.month.slice(5))}月部门均分最低，为 ${quarterLow.value} 分；季末均分 ${quarterMonthlyTrend.at(-1)?.value ?? '—'} 分。` : '本季无可比较的评分月份。'
    })()
    : ''
  const model = {
    version: 'v2', reportKey, kind, months, previousMonths: previous,
    title: kind === 'quarter' ? `用后即评季报（${reportPeriod?.label || reportKey}）` : `用后即评月报（${reportKey.replace('-', '.')}）`,
    kpis: {
      avg, companyAvg, previousAvg,
      experienceAvg: average(currentScored.filter((row) => row.channel === 'sms' || row.channel === 'console')),
      totalSample: currentScored.length,
      companySample: companyScored.length,
      productCount: products.length,
      belowNineCount: products.filter((row) => row.belowNine).length,
      belowNineNames: products.filter((row) => row.belowNine).map((row) => row.name),
      callbackUnqualifiedCount: computeInternalSatisfactionMetrics(
        postUseRecordsToScoredRows(currentScored.map((row) => ({ ...row, productName: productOf(row) }))),
        { productNames: productNames },
      ).notQualified.length,
    },
    products, themes, reasons, actions: allActions, focus,
    departmentTrend,
    companyTrend,
    satisfactionTrend: satisfactionMonths,
    quarterMonthlyTrend,
    quarterChange,
    positiveCount: positiveRegistry.length,
    quoteRegistry: registry,
    lowScoreRecordCount: distinct(themes.filter((row) => row.type === 'low' && row.lowestScore <= 5).flatMap((row) => row.recordIds)).length,
    previousVisits: kind === 'month' ? previousVisitRows(visits, reportKey) : [],
    customers: buildCustomerInsights(
      currentScored.map((row) => ({ ...row, productName: productOf(row) })),
      reportVisits.filter((visit) => productNames.includes(productOf(visit)))
        .map((visit) => ({ ...visit, productName: productOf(visit) })),
    ),
    todoRows: Array.isArray(overlay?.narratives?.todoItems) ? overlay.narratives.todoItems : [],
    todoNote: overlay?.narratives?.todoNote || '',
    recommendedFeedbackCount: distinct(themes.flatMap((row) => row.priority === 'P0' || row.priority === 'P1' ? row.recordIds : [])).length,
    judgment: overlay?.narratives?.judgment || '',
    hiddenSectionIds: overlay?.hiddenSectionIds || [],
  }
  model.dataFingerprint = dataFingerprint(model)
  model.validation = validatePostUseReportV2(model)
  return model
}

/** Export-blocking checks; readers never see their internal diagnostics. */
export function validatePostUseReportV2(model, actionOverrides = {}) {
  const errors = []
  const productSample = model.products.reduce((sum, product) => sum + product.sample, 0)
  if (productSample !== model.kpis.totalSample) errors.push(`样本量不一致：概述 ${model.kpis.totalSample}、产品合计 ${productSample}`)
  if (model.products.length !== model.kpis.productCount) errors.push(`产品数不一致：概述 ${model.kpis.productCount}、产品列表 ${model.products.length}`)
  if (distinct(model.products.map((product) => product.name)).length !== model.products.length) errors.push('产品列表存在重复产品')
  for (const product of model.products) {
    if (model.actions.filter((row) => row.productName === product.name).length > 5) errors.push(`${product.name} 建议举措超过 5 条`)
  }
  if (model.focus.some((row) => !model.actions.some((action) => action.id === row.id))) errors.push('关注清单与分产品举措不一致')
  const positive = model.products.reduce((sum, product) => sum + product.positiveCount, 0)
  if (positive !== model.positiveCount) errors.push(`正反馈计数不一致：概述 ${model.positiveCount}、产品合计 ${positive}`)
  const registeredPositive = model.quoteRegistry.filter(isReportV2PraiseQuote).length
  if (registeredPositive !== model.positiveCount) errors.push(`正反馈计数不一致：概述 ${model.positiveCount}、附录登记 ${registeredPositive}`)
  for (const product of model.products) {
    const distribution = Object.values(product.distribution).reduce((sum, value) => sum + value, 0)
    if (distribution !== product.sample) errors.push(`${product.name} 评分分布与样本量不一致`)
    if (model.kind === 'quarter') {
      const monthly = product.monthly.reduce((sum, row) => sum + row.sample, 0)
      if (monthly !== product.sample) errors.push(`${product.name} 月度分解与季度累计不一致`)
      const weighted = product.monthly.reduce((sum, row) => sum + (row.value ?? 0) * row.sample, 0)
      if (product.sample && Math.abs(weighted / product.sample - product.avg) > 0.02) {
        errors.push(`${product.name} 月度均分与季度均分不一致`)
      }
    }
  }
  for (const focus of model.focus) {
    const actionText = String(actionOverrides[focus.id]?.text ?? focus.text ?? '').trim()
    if (!actionText) errors.push(`${focus.productName}「${focus.theme}」缺少举措`)
    if (!String(actionOverrides[focus.id]?.title ?? focus.title ?? '').trim()) errors.push(`${focus.productName}「${focus.theme}」缺少关注结论`)
    if (!String(actionOverrides[focus.id]?.detail ?? focus.detail ?? '').trim()) errors.push(`${focus.productName}「${focus.theme}」缺少补充事实`)
    const owner = String(actionOverrides[focus.id]?.owner ?? focus.owner ?? '').trim()
    if (!owner) errors.push(`${focus.productName}「${focus.theme}」缺少责任人`)
  }
  return errors
}
