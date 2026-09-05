import {
  getLlmCompletionText,
  isLlmAvailable,
  llmChatCompletion,
  parseLlmMessageContent,
} from '../llmClient.js'
import { allowedEvidenceIdSet } from './buildBrief.js'

/**
 * @param {object} brief
 * @param {object} [settings]
 */
export async function polishTopicBriefWithLlm(brief, settings) {
  if (!isLlmAvailable(settings) || !brief.decision) return null
  const allowed = allowedEvidenceIdSet(brief)
  const payload = {
    title: brief.topic?.title,
    type: brief.topic?.type,
    scope: brief.scope,
    decision: {
      qualitative: brief.decision.qualitative,
      urgency: brief.decision.urgency,
      attribution: brief.decision.attribution,
      action: brief.decision.action,
    },
    quotes: (brief.quotes || []).slice(0, 8),
    sources: (brief.sources || []).slice(0, 20).map((row) => ({
      id: row.id,
      ticketId: row.ticketId,
      sourceLabel: row.sourceLabel,
      summary: row.summary,
    })),
    supplements: (brief.supplementItems || []).slice(0, 12),
    actions: brief.actions || [],
    gaps: brief.toSupplement || [],
  }
  const data = await llmChatCompletion(settings, {
    temperature: 0.2,
    max_tokens: 1200,
    messages: [
      {
        role: 'system',
        content:
          '你是云产品体验分析师。只润色输入 decision 的 qualitative.text、attribution.text、action.what；不得改 P级、数字、状态、角色、验证方式或新增团队/人名。输出 JSON：{"decision":{"qualitativeText":"...","attributionText":"...","actionWhat":"...","sourceIds":["..."]}}。sourceIds 必须来自输入中的 id/ticketId。禁止编造任何事实。',
      },
      {
        role: 'user',
        content: JSON.stringify(payload),
      },
    ],
  })
  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const decision = parsed?.decision
  if (!decision || typeof decision !== 'object') return null
  const sourceIds = (Array.isArray(decision.sourceIds) ? decision.sourceIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => allowed.has(id))
  if (allowed.size > 0 && sourceIds.length === 0) return null
  const text = (value, fallback) => {
    const next = String(value || '').trim()
    return next && next.length <= 80 ? next : fallback
  }
  return {
    ...brief.decision,
    qualitative: {
      ...brief.decision.qualitative,
      text: text(decision.qualitativeText, brief.decision.qualitative?.text),
      sourceIds: sourceIds.length ? sourceIds : brief.decision.qualitative?.sourceIds,
    },
    attribution: {
      ...brief.decision.attribution,
      text: text(decision.attributionText, brief.decision.attribution?.text),
      sourceIds: sourceIds.length ? sourceIds : brief.decision.attribution?.sourceIds,
    },
    action: {
      ...brief.decision.action,
      what: text(decision.actionWhat, brief.decision.action?.what),
    },
    llmPolished: true,
  }
}

function clampText(value, fallback, max) {
  const next = String(value || '').trim()
  if (!next) return fallback
  return next.length <= max ? next : next.slice(0, max)
}

function filterSourceIds(ids, allowed) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || '').trim())
    .filter((id) => allowed.has(id))
}

/**
 * 扩写分析专章叙事与建议，不改 P 级、数字、角色，不宣布根因已证实。
 * @param {object} brief
 * @param {object} [settings]
 */
export async function polishTopicAnalysisWithLlm(brief, settings) {
  if (!isLlmAvailable(settings) || !brief?.analysis) return brief
  const allowed = allowedEvidenceIdSet(brief)
  const analysis = brief.analysis
  const payload = {
    title: brief.topic?.title,
    qualitative: brief.decision?.qualitative?.text,
    attribution: brief.decision?.attribution?.text,
    quantitative: {
      sourceMix: analysis.quantitative?.sourceMix,
      trend: analysis.quantitative?.trend,
      concentrationNote: analysis.quantitative?.concentrationNote,
      sentiment: analysis.quantitative?.sentiment,
    },
    facts: (analysis.qualitative?.facts || []).map((row) => row.text),
    whyHappened: {
      chain: (analysis.whyHappened?.chain || []).map((step) => ({
        label: step.label,
        text: step.text,
        missing: step.missing,
      })),
      hypotheses: (analysis.whyHappened?.hypotheses?.items || []).map((item) => ({
        id: item.id,
        statement: item.statement,
        support: item.support,
        counter: item.counter,
      })),
      note: analysis.whyHappened?.hypotheses?.note,
      disclaimer: analysis.whyHappened?.disclaimer,
    },
    recommendations: (analysis.recommendations || []).map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      why: item.why,
      text: item.text,
    })),
    quotes: (brief.quotes || []).slice(0, 8).map((quote) => ({
      id: quote.id,
      ticketId: quote.ticketId,
      text: quote.text,
    })),
    sources: (brief.sources || []).slice(0, 20).map((row) => ({
      id: row.id,
      ticketId: row.ticketId,
    })),
  }
  const data = await llmChatCompletion(settings, {
    temperature: 0.2,
    max_tokens: 1600,
    messages: [
      {
        role: 'system',
        content:
          '你是云产品体验分析师。只扩写分析叙事与建议措辞，不得改 P 级、数字、角色、建议类型或宣布根因已证实。输出 JSON：{"narrative":"发生了什么与为何现在看，合计不超过400字","whyHappenedNarrative":"为什么发生的机制叙述，150到250字，必须标明假设","recommendations":[{"id":"与输入相同","text":"不超过120字"}],"sourceIds":["..."]}。sourceIds 必须来自输入 id/ticketId。禁止编造事实、金额或时长。',
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  })
  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  if (!parsed || typeof parsed !== 'object') return brief
  const sourceIds = filterSourceIds(parsed.sourceIds, allowed)
  const recById = new Map(
    (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).map((row) => [String(row?.id || ''), row]),
  )
  const whyNarrative = clampText(parsed.whyHappenedNarrative, analysis.whyHappened?.narrative || '', 250)
  return {
    ...brief,
    llmApplied: true,
    analysis: {
      ...analysis,
      narrative: clampText(parsed.narrative, analysis.narrative || '', 400),
      whyHappened: {
        ...analysis.whyHappened,
        narrative: whyNarrative,
        sourceIds: sourceIds.length ? sourceIds : analysis.whyHappened?.sourceIds,
      },
      recommendations: (analysis.recommendations || []).map((item) => ({
        ...item,
        text: clampText(recById.get(item.id)?.text, item.text, 120),
      })),
    },
  }
}
