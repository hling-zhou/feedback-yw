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
