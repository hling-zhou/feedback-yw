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
  if (!isLlmAvailable(settings)) return []
  const allowed = allowedEvidenceIdSet(brief)
  const payload = {
    title: brief.topic?.title,
    type: brief.topic?.type,
    scope: brief.scope,
    whyNow: brief.whyNow,
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
          '你是云产品体验分析师。只根据给定证据包与用户补充材料写初步判断。输出 JSON：{"judgments":[{"text":"...","sourceIds":["..."]}]}。sourceIds 必须来自输入中的 id/ticketId。禁止编造工单、客户或指标。每条 1-3 句。最多 6 条。',
      },
      {
        role: 'user',
        content: JSON.stringify(payload),
      },
    ],
  })
  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const rows = Array.isArray(parsed?.judgments) ? parsed.judgments : []
  return rows
    .map((row, index) => {
      const text = String(row?.text || '').trim()
      const sourceIds = (Array.isArray(row?.sourceIds) ? row.sourceIds : [])
        .map((id) => String(id || '').trim())
        .filter((id) => allowed.has(id))
      if (!text) return null
      if (allowed.size > 0 && sourceIds.length === 0) return null
      return {
        id: `llm-${index}`,
        kind: 'ai',
        text,
        sourceIds,
      }
    })
    .filter(Boolean)
    .slice(0, 6)
}
