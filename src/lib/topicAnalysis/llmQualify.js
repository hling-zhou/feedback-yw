import {
  getLlmCompletionText,
  isLlmAvailable,
  llmChatCompletion,
  parseLlmMessageContent,
} from '../llmClient.js'

/**
 * Validates an LLM-proposed semantic split. It can only add a split signal;
 * rule-derived split decisions are never removed.
 * @param {object} evidence
 * @param {object} parsed
 */
export function applySemanticSplitResult(evidence, parsed) {
  const proposal = parsed?.semanticSplit
  const sourceRows = [...(evidence.quotes || [])]
  const allowedIds = new Set(sourceRows.flatMap((quote) => [quote.id, quote.recordId, quote.ticketId]).filter(Boolean).map(String))
  const clusters = (Array.isArray(proposal?.clusters) ? proposal.clusters : [])
    .map((cluster) => ({
      label: String(cluster?.label || '').trim().slice(0, 32),
      sourceIds: (Array.isArray(cluster?.sourceIds) ? cluster.sourceIds : [])
        .map((id) => String(id || '').trim())
        .filter((id) => allowedIds.has(id)),
    }))
    .filter((cluster) => cluster.label && cluster.sourceIds.length >= 2)
  const uniqueClusters = []
  const used = new Set()
  for (const cluster of clusters) {
    const ids = cluster.sourceIds.filter((id) => !used.has(id))
    if (ids.length < 2) continue
    ids.forEach((id) => used.add(id))
    uniqueClusters.push({ ...cluster, sourceIds: ids })
  }
  if (!proposal?.suggestSplit || uniqueClusters.length < 2) return evidence
  return {
    ...evidence,
    signalPack: {
      ...evidence.signalPack,
      semanticSplitSuggested: true,
      semanticClusters: uniqueClusters.slice(0, 3),
    },
  }
}

/**
 * Uses quoted customer language to conservatively flag semantically distinct topics.
 * @param {object} evidence
 * @param {object} [settings]
 */
export async function qualifyTopicEvidenceWithLlm(evidence, settings) {
  if (!isLlmAvailable(settings) || (evidence.signalPack?.sample?.quoteCount || 0) < 5) return evidence
  const quotes = (evidence.quotes || []).slice(0, 8).map((quote) => ({
    id: quote.recordId || quote.id,
    ticketId: quote.ticketId,
    text: quote.text,
  }))
  if (quotes.length < 5) return evidence
  const data = await llmChatCompletion(settings, {
    temperature: 0,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: '你是体验研究分析师。仅根据原话判断是否存在至少两类语义不同、各至少2条独立工单支持的问题。输出 JSON：{"semanticSplit":{"suggestSplit":true,"clusters":[{"label":"不超过16字","sourceIds":["工单id"]}]}}。只能引用输入 id/ticketId；证据不足时 suggestSplit=false。不得判断根因、优先级或行动。',
      },
      { role: 'user', content: JSON.stringify({ topic: evidence.topic?.title, quotes }) },
    ],
  })
  return applySemanticSplitResult(evidence, parseLlmMessageContent(getLlmCompletionText(data)))
}
