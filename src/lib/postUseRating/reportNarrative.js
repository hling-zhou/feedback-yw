import { getLlmCompletionText, llmChatCompletion, parseLlmMessageContent } from '../llmClient.js'
import { draftReportNegativeDetail } from './reportEvidence.js'

function clean(value) { return String(value || '').trim() }

function sourceSummary(traces, visits, evidence) {
  const active = (evidence?.issues || []).filter((row) => row.status !== 'excluded_no_issue')
  const linkedTraces = new Set((evidence?.issues || []).flatMap((row) => row.linkedTraceIds || []))
  const activeTraces = new Set(active.flatMap((row) => row.linkedTraceIds || []))
  const linkedVisits = new Set((evidence?.issues || []).flatMap((row) => row.linkedVisitIds || []))
  const activeVisits = new Set(active.flatMap((row) => row.linkedVisitIds || []))
  const traceFacts = (traces || []).filter((row) => clean(row.progress)).map((row) => ({
    id: String(row.id || ''), customer: clean(row.customerName),
    progress: clean(row.progress), assignee: clean(row.assigneeName),
    linked: linkedTraces.has(String(row.id || '')),
    linkedActive: activeTraces.has(String(row.id || '')),
  }))
  const visitFacts = (visits || []).filter((row) => (
    clean(row.visitResult || row.visitFeedbackDetail) || clean(row.internalEvaluationDetail || row.internalConclusion)
  )).map((row) => ({
    id: String(row.id || ''), customer: clean(row.customerName || row.groupName),
    result: clean(row.visitResult || row.visitFeedbackDetail),
    evaluation: clean(row.internalEvaluationDetail || row.internalConclusion),
    remark: clean(row.remark),
    linked: linkedVisits.has(String(row.id || '')),
    linkedActive: activeVisits.has(String(row.id || '')),
  }))
  return { traceFacts, visitFacts }
}

export function buildReportProductNarrative({ productName, evidence, overview, score = null, changes = [], actionRows = [], traces = [], visits = [], periodLabel = '本期' }) {
  const activeThemes = (evidence?.themes || []).filter((row) => row.activeCount > 0)
  const excludedThemes = (evidence?.themes || []).filter((row) => row.excludedCount > 0)
  const { traceFacts, visitFacts } = sourceSummary(traces, visits, evidence)
  const growing = changes.find((row) => row.productName === productName && ['新增', '增长'].includes(row.change))
  const pending = actionRows.find((row) => row.productName === productName && row.status === 'recommended')
  const priority = overview?.stateCode === 'critical' ? '重点改善'
    : overview?.stateCode === 'watch' ? '持续观察'
      : growing ? '新增或增长问题' : pending ? '待推动举措' : ''
  const sample = Number(overview?.sampleSize ?? score?.sampleSize ?? 0)
  const avg = overview?.avgScore ?? score?.avgScore ?? null
  const scoreSentence = `体验均分 ${avg == null ? '暂无' : `${avg} 分`}，体验样本 ${sample} 条，状态「${overview?.state || '暂无判定'}」`
  const themeSentence = activeThemes.length
    ? `当前仍需处理：${activeThemes.map((row) => `「${row.issue}」${row.activeCount} 次`).join('、')}`
    : excludedThemes.length ? `相关问题已由回访排除 ${evidence.excludedIssueCount} 次，当前无待处理的同类问题`
      : '本期未检出有效负反馈问题'
  const resultFacts = [
    ...traceFacts.map((row) => `产品部溯源 ${row.customer || row.id}${row.linked ? '' : '（未关联具体问题）'}：${row.progress}`),
    ...visitFacts.map((row) => `省代表回访 ${row.customer || row.id}${row.linked ? '' : '（未关联具体问题）'}：${row.result}${row.evaluation ? `；内部评估：${row.evaluation}` : ''}`),
  ]
  const focusIssue = activeThemes[0]?.issue || ''
  const owner = traceFacts.find((row) => row.linkedActive && row.assignee)?.assignee || '产品部经办人'
  const linkedBasis = [
    ...traceFacts.filter((row) => row.linkedActive).map((row) => `产品部溯源 ${row.customer || row.id}：${row.progress}`),
    ...visitFacts.filter((row) => row.linkedActive).map((row) => `省代表回访 ${row.customer || row.id}：${row.result}${row.evaluation ? `；内部评估：${row.evaluation}` : ''}`),
  ]
  const pendingText = clean(pending?.action?.content || pending?.title)
  const actionDraft = activeThemes.length
    ? [
        `${owner}针对「${focusIssue}」核对受影响场景、复现条件和处理结果，并记录责任人、完成时间；下一个报告周期复核同问题是否再次出现。`,
        pendingText ? `推进现有事项「${pendingText}」，以问题复现或客户确认结果作为验收依据。` : '',
        ...linkedBasis.map((fact) => `依据：${fact}。`),
        !linkedBasis.length && resultFacts.length ? '先在反馈库核对并关联同客户、同产品的回溯或回访记录，再据此调整该问题的处理结论。' : '',
      ].filter(Boolean).join('\n')
    : excludedThemes.length
      ? `将已确认无问题的回访结论关联到对应客户、产品和具体问题；保留原始评分，下一期核对该问题是否重现。${resultFacts.length ? `依据：${resultFacts.join('；')}。` : ''}`
      : pendingText
        ? `推进现有事项「${pendingText}」，记录负责人、完成时间和验收结果。`
        : '本期暂无待处理负反馈；下一期复核该产品的低分与新增原话。'
  const priorityLead = priority ? `${productName}：${priority}。` : `${productName}：${scoreSentence}。`
  const conclusionDraft = [
    priorityLead,
    priority ? `${scoreSentence}。` : '',
    growing ? `「${growing.issue}」${growing.change}（${growing.previousCount} → ${growing.currentCount}）。` : '',
    `${themeSentence}。`,
    resultFacts.length ? `核实与评估：${resultFacts.join('；')}。` : '',
    activeThemes.length ? `下一步：由${owner}推进「${focusIssue}」的核查与闭环。` : '',
  ].filter(Boolean).join('')
  return {
    detailDraft: draftReportNegativeDetail(evidence),
    actionDraft,
    conclusionDraft,
    priority,
    sourceRefs: {
      ratingIds: [...new Set((evidence?.pieces || []).map((row) => row.recordId).filter(Boolean))],
      traceIds: traceFacts.map((row) => row.id).filter(Boolean),
      visitIds: visitFacts.map((row) => row.id).filter(Boolean),
    },
    facts: {
      productName, scoreSentence, priority, activeThemes, excludedThemes,
      quotes: evidence?.quotes || [], traceFacts, visitFacts,
      growing: growing || null, pending: pending || null,
    },
  }
}

/** A short, stable digest ensures saved AI text is ignored after any source fact changes. */
export function reportNarrativeFingerprint(facts) {
  const source = JSON.stringify(facts || {})
  let hash = 2166136261
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `v1:${(hash >>> 0).toString(16)}:${source.length}`
}

async function askLlm(settings, messages, requiredKeys) {
  let failure = '返回格式不完整'
  for (const maxTokens of [3000, 6000]) {
    const response = await llmChatCompletion(settings, {
      messages, temperature: 0.2, max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    })
    const choice = response?.data?.choices?.[0] || response?.choices?.[0]
    if (['length', 'max_tokens'].includes(choice?.finish_reason)) {
      failure = '输出被截断'
      continue
    }
    try {
      const parsed = /** @type {Record<string, any>} */ (parseLlmMessageContent(getLlmCompletionText(response)))
      if (parsed && requiredKeys.every((key) => typeof parsed[key] === 'string' && parsed[key].trim())) return parsed
      failure = `缺少字段 ${requiredKeys.join('、')}`
    } catch {
      failure = '返回格式不是完整 JSON'
    }
  }
  throw new Error(`模型${failure}，重试后仍未得到完整文字稿；当前继续显示规则稿`)
}

/** AI changes only narrative text; numbers and problem status remain rule-owned. */
export async function generateReportProductDraft(settings, narrative) {
  const facts = narrative.facts
  const source = {
    productName: facts.productName,
    themes: [...facts.activeThemes, ...facts.excludedThemes],
    quotes: facts.quotes.map((row) => ({ text: row.text, count: row.count, lowestScore: row.lowestScore, excludedCount: row.excludedCount, recordIds: row.recordIds })),
    productTraces: facts.traceFacts,
    representativeVisits: facts.visitFacts,
    nextStep: narrative.actionDraft,
  }
  const quoteChunks = []
  let chunk = []
  let size = 0
  for (const row of source.quotes) {
    const raw = JSON.stringify(row)
    if (chunk.length && size + raw.length > 12000) { quoteChunks.push(chunk); chunk = []; size = 0 }
    chunk.push(row); size += raw.length
  }
  if (chunk.length) quoteChunks.push(chunk)
  const summaries = []
  for (const rows of quoteChunks) {
    const part = await askLlm(settings, [
      { role: 'system', content: '你是用后即评报告编辑。仅依据给定原话总结这一批负反馈，不推断未提供的事实。输出 JSON：{"summary":"..."}。保留低分优先、原话高频及已排除标记。' },
      { role: 'user', content: JSON.stringify(rows) },
    ], ['summary'])
    summaries.push(part.summary.trim())
  }
  const result = await askLlm(settings, [
    { role: 'system', content: '你是用后即评月季报告编辑。只写有来源的文字，不改均分、样本、次数、优先级或排除状态。未关联的产品部溯源和回访只作为产品层背景，不得指认为某一具体问题的结论。省代表回访确认无问题的具体问题视为已排除。举措须落实核查对象、责任方与验收方式，禁止空话。返回 JSON：{"detail":"完整负反馈文字综合","action":"具体建议举措","conclusion":"核实结果和下一步关注"}。不得输出 Markdown。' },
    { role: 'user', content: JSON.stringify({ ...source, quotes: undefined, quoteSummaries: summaries, ruleConclusion: narrative.conclusionDraft }) },
  ], ['detail', 'action', 'conclusion'])
  const actionRefs = facts.traceFacts.filter((row) => row.linkedActive).map((row) => `产品部溯源 ${row.id}`)
    .concat(facts.visitFacts.filter((row) => row.linkedActive).map((row) => `省代表回访 ${row.id}`))
  return {
    detail: `${narrative.detailDraft}\n综合说明：${result.detail.trim()}`,
    action: `${result.action.trim()}\n依据：${actionRefs.join('、') || '本期评分原话登记'}。`,
    conclusion: `${narrative.conclusionDraft}\n综合关注：${result.conclusion.trim()}`,
  }
}
