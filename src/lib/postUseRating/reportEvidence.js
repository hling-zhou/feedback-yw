import { classifyFeedbackPolarity, extractValidCustomerTexts } from './customerQuotes.js'
import { normalizeEvidenceText } from './evidence.js'
import { matchAllReasonTaxonomy } from './reasonTaxonomy.js'

function stableEvidenceId(parts) {
  const value = JSON.stringify(parts)
  let a = 2166136261
  let b = 0x9e3779b9
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    a = Math.imul(a ^ code, 16777619)
    b = Math.imul(b + code, 2246822519)
  }
  return `e:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`
}

export function reportProductName(record) {
  return String(record?.product || record?.productName || '').trim()
}

export function reportMonth(record) {
  return String(record?.importMonth || record?.createdAt || '').slice(0, 7)
}

export function reportCustomerMatches(left, right) {
  const leftCode = String(left?.customerCode || '').trim()
  const rightCode = String(right?.customerCode || '').trim()
  if (leftCode && rightCode) return leftCode === rightCode
  const leftName = String(left?.customerName || '').trim()
  const rightName = String(right?.customerName || right?.groupName || right?.userInfoDetail || '').trim()
  return Boolean(leftName && rightName && leftName !== '匿名客户' && leftName === rightName)
}

/** Only explicit no-problem wording is eligible for automatic exclusion. */
export function isExplicitNoProblemVisit(visit) {
  const result = normalizeEvidenceText(visit?.visitResult || visit?.visitFeedbackDetail)
  return /^(?:(?:经省代表回访|经回访|客户|省代表|经核实|回访)(?:核实|确认)?[，,:：]?\s*)?(?:无问题|没有问题|未发现问题|未复现问题|不存在问题)(?:[。；;，,\s]|$)/.test(result)
}

/**
 * 11-19 两档剔除（用户拍板）·档 1 全剔除：省代表回访结果判定"无实际不满"——
 * 客户其实没有不满（误操作/情绪分），五模块全不进（关注项/部门低分原因汇总/核心结论/问题主题分布/建议举措）。
 * 仅看 visitResult（回访结果）；internalConclusion（内部评估）归档 2。
 */
export function isNoDissatisfactionVisit(visit) {
  const result = normalizeEvidenceText(visit?.visitResult || visit?.visitFeedbackDetail)
  return /无实际不满/.test(result)
}

/**
 * 11-19 两档剔除（用户拍板）·档 2 半剔除：回访结果未判无实际不满，但内部评估选了
 * "无需优改（客户误操作/账户异常/极小概率场景）"类（枚举值本身含"无实际不满"字样，
 * 用户拍板按档 2 处理）；或产品部溯源判定无需优改类——问题存在但不值得优化，
 * 不进定性（关注项/核心结论），进定量（部门低分原因汇总/问题主题分布）。
 */
export function isNoActionNeededConclusion(text) {
  const value = normalizeEvidenceText(text)
  return /无需优?改|无需优化/.test(value)
}

/**
 * 11-19 晚拍板（按对象剔除）：复合句识别——文本既含"无实际不满"又含另一处不满信号
 * （如"客户对于模型使用不满，对云监控无实际不满"）。此类句子正则无法识别"不满的宾语对象"，
 * 正则层按"无实际不满"先剔保底，但必须送 LLM verdicts 复核（反序句会被正则误剔，LLM 可判 keep 拉回）。
 */
export function isCompoundDissatisfactionText(text) {
  const value = normalizeEvidenceText(text)
  if (!value.includes('无实际不满')) return false
  const residual = value.replace(/无实际不满/g, '')
  return /不满|未解决|仍有问题|还没改/.test(residual)
}

/**
 * 11-19 晚拍板（按对象剔除）：判断回访文本中的"不满"是否指向产品目录内产品。
 * 背景：复合句"客户对于模型使用不满，对云监控无实际不满"——不满对象是"模型使用"
 * （非目录产品），对产品本身无实际不满 → 应剔除；若不满对象是目录内另一产品名
 * （如"对弹性公网IP不满，对云监控无实际不满"）→ 产品范围内有真实不满，不剔。
 * 实现：剥掉"无实际不满"语境后检测剩余"不满"信号句，并检查句内是否含目录产品名/别名。
 * catalogNames = 目录产品名 + 规格 match 别名清单（扁平字符串数组）。
 */
export function dissatisfiedWithinCatalog(text, catalogNames = []) {
  const value = normalizeEvidenceText(text)
  if (!/不满|未解决|仍有问题|还没改/.test(value)) return false
  // 剥掉"无实际不满"（含其后缀语境）后再测剩余不满信号，避免复合句误判
  const residual = value.replace(/无实际不满/g, '')
  if (!/不满|未解决|仍有问题|还没改/.test(residual)) return false
  if (!catalogNames.length) return true
  const names = catalogNames.map((name) => String(name || '').trim()).filter(Boolean)
  return names.some((name) => residual.includes(name))
}

/**
 * 目录产品名+规格 match 别名 → 扁平清单（11-19 按对象剔除的输入）。
 * catalog = post_use_product_catalog 目录数组（name + specs[].match）。
 */
export function catalogProductNames(catalog = []) {
  const names = []
  for (const item of catalog || []) {
    const name = String(item?.name || '').trim()
    if (name) names.push(name)
    for (const spec of item?.specs || []) {
      for (const alias of spec?.match || []) {
        const value = String(alias || '').trim()
        if (value && !names.includes(value)) names.push(value)
      }
    }
  }
  return names
}

function sourceTexts(record) {
  const primary = extractValidCustomerTexts(record)
  const channel = String(record?.channel || record?.sourceSubType || '').trim()
  if (!['console', 'web_survey', 'option', 'web_option'].includes(channel)) return primary
  // The general quote registry chooses reason columns before commentText. Reports require both.
  const comment = extractValidCustomerTexts({
    ...record,
    feedbackReasonTexts: [],
    feedbackReasonPrimary: '',
    feedbackReasonSecondary: '',
    feedbackReasonTertiary: '',
  })
  const seen = new Set(primary.map((row) => `${row.kind}\0${row.text}`))
  return [...primary, ...comment.filter((row) => !seen.has(`${row.kind}\0${row.text}`))]
}

/** One feedback piece may contain several known issue labels; each label gets its own occurrence. */
export function buildReportIssueOccurrences(records) {
  const out = []
  for (const record of records || []) {
    const productName = reportProductName(record)
    const recordId = String(record?.id || record?.ratingId || '').trim()
    if (!productName) continue
    for (const item of sourceTexts(record)) {
      if (classifyFeedbackPolarity(item) !== 'negative') continue
      const text = normalizeEvidenceText(item.text)
      if (!text) continue
      const matches = matchAllReasonTaxonomy(text, item.channel).map((row) => row.label)
      const issues = matches.length ? matches : [text]
      const pieceId = stableEvidenceId([recordId, item.kind, text])
      for (const issueName of issues) {
        out.push({
          id: stableEvidenceId([pieceId, issueName]),
          pieceId,
          recordId,
          productName,
          customerCode: String(record?.customerCode || '').trim(),
          customerName: String(record?.customerName || '').trim(),
          month: reportMonth(record),
          score: item.score,
          channel: item.channel,
          kind: item.kind,
          text,
          issueName,
          multiIssueText: issues.length > 1,
        })
      }
    }
  }
  return out
}

export function visitSourceFingerprint(visit) {
  return JSON.stringify([
    String(visit?.id || ''), reportProductName(visit),
    String(visit?.customerCode || ''), String(visit?.customerName || ''),
    normalizeEvidenceText(visit?.userFeedbackText),
    normalizeEvidenceText(visit?.visitResult || visit?.visitFeedbackDetail),
  ])
}

export function traceSourceFingerprint(trace) {
  return JSON.stringify([
    String(trace?.id || ''), reportProductName(trace),
    String(trace?.customerCode || ''), String(trace?.customerName || ''),
    normalizeEvidenceText(trace?.customerFeedback),
  ])
}

function validSource(issue, source) {
  const months = String(source?.importMonth || source?.visitMonth || '').split('、').map((month) => month.trim())
  return source
    && reportProductName(source) === issue.productName
    && reportCustomerMatches(issue, source)
    && months.includes(issue.month)
}

/** The persisted decision has no effect if its source record was deleted or materially changed. */
export function resolveReportIssues(occurrences, visits = [], traces = [], links = [], catalogNames = []) {
  const visitById = new Map((visits || []).map((row) => [String(row?.id || ''), row]))
  const traceById = new Map((traces || []).map((row) => [String(row?.id || ''), row]))
  const linksByIssue = new Map()
  for (const link of links || []) {
    const list = linksByIssue.get(link.issueId) || []
    list.push(link)
    linksByIssue.set(link.issueId, list)
  }
  return (occurrences || []).map((issue) => {
    const validLinks = (linksByIssue.get(issue.id) || []).filter((link) => {
      const source = link.sourceType === 'visit'
        ? visitById.get(link.sourceId)
        : link.sourceType === 'trace' ? traceById.get(link.sourceId) : null
      if (!validSource(issue, source)) return false
      return link.sourceFingerprint === (link.sourceType === 'visit'
        ? visitSourceFingerprint(source) : traceSourceFingerprint(source))
    })
    const linkedVisitIds = validLinks.filter((row) => row.sourceType === 'visit').map((row) => row.sourceId)
    const linkedTraceIds = validLinks.filter((row) => row.sourceType === 'trace').map((row) => row.sourceId)
    const exactVisits = issue.multiIssueText || validLinks.some((row) => row.sourceType === 'visit')
      ? []
      : (visits || []).filter((visit) => (
        validSource(issue, visit)
        && normalizeEvidenceText(visit?.userFeedbackText) === issue.text
        && isExplicitNoProblemVisit(visit)
      ))
    const autoVisit = exactVisits.length === 1 ? exactVisits[0] : null
    const exactTraces = issue.multiIssueText || validLinks.some((row) => row.sourceType === 'trace')
      ? []
      : (traces || []).filter((trace) => (
        validSource(issue, trace)
        && normalizeEvidenceText(trace?.customerFeedback) === issue.text
      ))
    const autoTrace = exactTraces.length === 1 ? exactTraces[0] : null
    // 11-19 两档剔除（用户拍板，客户+产品+本期匹配，非逐字）：
    // 档 1 全剔除——回访结果"无实际不满"（省代表核实客户无真实不满）→ excluded_no_issue
    // 档 2 半剔除——内部评估"无需优改"类 或 产品部溯源"无需优改"类 → excluded_no_action（进定量不进定性）
    // 沿用 validSource（客户+产品+月份窗口）防误杀：同客户其他产品/其他期的问题不受影响。
    // 11-19 审查防御（用户拍板"不满意优先"）：矛盾回访对（同客户同产品既有"无实际不满"又有
    // 不满意措辞）不自动剔除——回访数据月粒度无法判时间序，自动剔除可能吞掉真实不满；
    // 回退人工 link 判定路径（verdict=no_issue 的 link 仍然生效）。
    // 11-19 晚拍板（按对象剔除，用户细化规则）：不满信号按**对象**判——剥掉"无实际不满"
    // 语境后剩余不满的对象是目录内产品名（如"对弹性公网IP不满"）→ 范围内有真实不满不剔；
    // 不满对象非目录产品（如"对模型使用不满"）→ 产品范围外，剔除生效（复合句不再误触发防御）。
    // 11-19 晚修正（正则无法可靠识别"不满的宾语对象"——剥句后残留产品名会被误当不满对象，
    // 实测"对模型使用不满，对云监控无实际不满"误判保留）：复合句（同时含"无实际不满"与
    // 剩余"不满"信号）不在此层判——交给 LLM verdicts 批按对象语义判定，未判前保持 open（不误剔）。
    const matchedVisits = (visits || []).filter((visit) => validSource(issue, visit))
    const hasDissatisfiedVisit = matchedVisits.some((visit) => {
      const text = String(visit?.visitResult || visit?.visitFeedbackDetail || '')
      // 判定表（11-19 晚拍板按对象剔除）：
      // ① keep 标记最优先：LLM 复核推翻正则先剔（复合句不满对象在产品范围内）→ 拦（拉回）；
      // ② 含"无实际不满"的其他文本（含复合句）不在此层拦——单纯句正则直接剔，
      //    复合句交 LLM verdicts 批按对象语义判（未判前正则先剔保底）；
      // ③ 无"无实际不满"但有不满信号（纯不满意）→ 拦（矛盾防御）。
      if (text.includes('LLM 判定：对产品仍有真实不满')) return true
      if (text.includes('无实际不满')) return false
      return /(?<!无实际)不满|未解决|仍有问题|还没改/.test(text)
    })
    const noDissatisfactionVisit = !hasDissatisfiedVisit
      ? matchedVisits.find((visit) => isNoDissatisfactionVisit(visit)) || null : null
    const noActionConclusionVisit = !hasDissatisfiedVisit
      ? matchedVisits.find((visit) => validSource(issue, visit)
        && !isNoDissatisfactionVisit(visit) && isNoActionNeededConclusion(visit?.internalConclusion || visit?.internalEvaluationDetail)) || null
      : null
    const noActionTrace = (traces || []).find((trace) => validSource(issue, trace)
      // 11-23 晚修复：progress（人工回溯结果）优先参与判定——结论写在 progress 的"无需优改"不再漏判
      && isNoActionNeededConclusion(trace?.recommendedReason || trace?.progress || trace?.customerFeedback)) || null
    // 11-23 拍板 verdict 四值消费：no_issue（存量兼容）与 no_dissatisfaction 同义（回访核实
    // 无实际不满→档 1 全剔除）；no_action（产品部评估无需优改——溯源结论/回访内部评估）→
    // 与既有正则半剔除同档（不进定性进定量），link 人工/LLM 判定优先于正则自动判定。
    const fullExcludedLink = validLinks.some((row) => row.sourceType === 'visit'
      && (row.verdict === 'no_issue' || row.verdict === 'no_dissatisfaction'))
    const noActionLink = validLinks.some((row) => row.verdict === 'no_action')
    const excluded = fullExcludedLink || Boolean(autoVisit) || Boolean(noDissatisfactionVisit)
    const halfExcluded = !excluded && Boolean(noActionConclusionVisit || noActionTrace || noActionLink)
    return {
      ...issue,
      status: excluded ? 'excluded_no_issue' : halfExcluded ? 'excluded_no_action' : 'open',
      resolutionSource: excluded
        ? (fullExcludedLink ? 'manual_visit' : autoVisit && !linkedVisitIds.length ? 'exact_visit' : linkedVisitIds.length || noDissatisfactionVisit ? 'no_dissatisfaction_visit' : 'manual_visit')
        : halfExcluded ? (noActionLink ? 'no_action_link' : noActionConclusionVisit ? 'no_action_conclusion' : 'no_action_trace') : '',
      linkedVisitIds: autoVisit || noDissatisfactionVisit
        ? [...new Set([...linkedVisitIds, String((autoVisit || noDissatisfactionVisit).id)])]
        : noActionConclusionVisit
          ? [...new Set([...linkedVisitIds, String(noActionConclusionVisit.id)])]
          : linkedVisitIds,
      linkedTraceIds: autoTrace || noActionTrace
        ? [...new Set([...linkedTraceIds, String((autoTrace || noActionTrace).id)])]
        : linkedTraceIds,
      staleLinkCount: (linksByIssue.get(issue.id) || []).length - validLinks.length,
    }
  })
}

function themeRows(issues) {
  const map = new Map()
  for (const issue of issues || []) {
    const key = `${issue.productName}\0${issue.issueName}`
    const row = map.get(key) || {
      productName: issue.productName, issue: issue.issueName,
      rawCount: 0, excludedCount: 0, activeCount: 0, lowestScore: null, evidenceIds: [],
    }
    row.rawCount += 1
    if (issue.status === 'excluded_no_issue') row.excludedCount += 1
    else row.activeCount += 1
    if (Number.isFinite(issue.score)) row.lowestScore = row.lowestScore == null ? issue.score : Math.min(row.lowestScore, issue.score)
    if (issue.recordId) row.evidenceIds.push(issue.recordId)
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.activeCount - a.activeCount || (a.lowestScore ?? 99) - (b.lowestScore ?? 99) || b.rawCount - a.rawCount)
}

export function buildReportProductEvidence(issues, productName) {
  const rows = (issues || []).filter((row) => row.productName === productName)
  const pieces = new Map()
  for (const issue of rows) {
    const entry = pieces.get(issue.pieceId) || {
      pieceId: issue.pieceId, text: issue.text, score: issue.score,
      recordId: issue.recordId, customerName: issue.customerName, customerCode: issue.customerCode,
      issueIds: [], excludedIssueCount: 0,
    }
    entry.issueIds.push(issue.id)
    if (issue.status === 'excluded_no_issue') entry.excludedIssueCount += 1
    pieces.set(issue.pieceId, entry)
  }
  const quoteMap = new Map()
  for (const piece of pieces.values()) {
    const key = piece.text.replace(/\s+/g, ' ').trim()
    const group = quoteMap.get(key) || { text: piece.text, count: 0, lowestScore: null, excludedCount: 0, recordIds: [] }
    group.count += 1
    if (piece.excludedIssueCount === piece.issueIds.length) group.excludedCount += 1
    if (piece.recordId) group.recordIds.push(piece.recordId)
    if (Number.isFinite(piece.score)) group.lowestScore = group.lowestScore == null ? piece.score : Math.min(group.lowestScore, piece.score)
    quoteMap.set(key, group)
  }
  const quotes = [...quoteMap.values()].sort((a, b) => (a.lowestScore ?? 99) - (b.lowestScore ?? 99) || b.count - a.count)
  const highFrequency = [...quoteMap.values()].sort((a, b) => b.count - a.count || (a.lowestScore ?? 99) - (b.lowestScore ?? 99))[0]
  const highlights = [...new Map([quotes[0], highFrequency].filter(Boolean).map((row) => [row.text, row])).values()]
  return {
    issues: rows,
    pieces: [...pieces.values()],
    themes: themeRows(rows),
    quotes,
    highlights,
    rawPieceCount: pieces.size,
    rawRecordCount: new Set([...pieces.values()].map((row) => row.recordId).filter(Boolean)).size,
    excludedIssueCount: rows.filter((row) => row.status === 'excluded_no_issue').length,
    activeIssueCount: rows.filter((row) => row.status !== 'excluded_no_issue').length,
  }
}

/** Every theme is retained; this draft is also the safe fallback when LLM is unavailable. */
export function draftReportNegativeDetail(evidence) {
  const count = Number(evidence?.rawPieceCount) || 0
  if (!count) return '本期未检出该产品的有效负反馈。'
  const themes = (evidence?.themes || []).map((row) => {
    const status = row.activeCount === 0
      ? `，均已由省代表回访确认无问题并排除`
      : row.excludedCount ? `，其中 ${row.excludedCount} 次已排除` : ''
    const low = row.lowestScore == null ? '' : `，最低 ${row.lowestScore} 分`
    return `「${row.issue}」原始 ${row.rawCount} 次${low}${status}`
  })
  const highlights = (evidence?.highlights || []).map((row) => (
    `「${row.text}」（原话 ${row.count} 次${row.lowestScore == null ? '' : `，最低 ${row.lowestScore} 分`}${row.excludedCount ? `，已排除 ${row.excludedCount} 次` : ''}）`
  ))
  return [
    `本期收集 ${count} 条有效负反馈片段，涉及 ${evidence?.rawRecordCount || 0} 条评分记录；原始评分与原话次数保留。`,
    `问题综合：${themes.join('；')}。`,
    highlights.length ? `优先关注低分和高频原话：${highlights.join('；')}。` : '',
  ].filter(Boolean).join('\n')
}

export function buildReportThemeRows(issues) {
  return themeRows(issues)
}

/** Report-only comparison: the exact current month/quarter against its adjacent predecessor. */
export function buildReportPeriodIssueChanges(issues, currentMonths, previousMonths, previousHasRecords = true) {
  if (!previousHasRecords) return []
  const currentSet = new Set(currentMonths || [])
  const previousSet = new Set(previousMonths || [])
  const bucket = (months) => {
    const map = new Map()
    for (const issue of issues || []) {
      if (issue.status === 'excluded_no_issue' || !months.has(issue.month)) continue
      const key = `${issue.productName}\0${issue.issueName}`
      const row = map.get(key) || { productName: issue.productName, issue: issue.issueName, count: 0, evidenceIds: [] }
      row.count += 1
      if (issue.recordId) row.evidenceIds.push(issue.recordId)
      map.set(key, row)
    }
    return map
  }
  const current = bucket(currentSet)
  const previous = bucket(previousSet)
  return [...new Set([...current.keys(), ...previous.keys()])].map((key) => {
    const now = current.get(key)
    const prev = previous.get(key)
    const currentCount = now?.count || 0
    const previousCount = prev?.count || 0
    let change = '持续'
    if (!previousCount && currentCount) change = '新增'
    else if (previousCount && !currentCount) change = '消失'
    else if (currentCount > previousCount) change = '增长'
    else if (currentCount < previousCount) change = '缓解'
    return {
      productName: (now || prev).productName,
      issue: (now || prev).issue,
      currentCount, previousCount, change,
      currentMonth: [...currentSet].at(-1) || '',
      previousMonth: [...previousSet].at(-1) || '',
      evidenceIds: [...(now?.evidenceIds || []), ...(prev?.evidenceIds || [])],
    }
  }).sort((a, b) => {
    const order = { 新增: 0, 增长: 1, 持续: 2, 缓解: 3, 消失: 4 }
    return order[a.change] - order[b.change] || b.currentCount - a.currentCount
  })
}
