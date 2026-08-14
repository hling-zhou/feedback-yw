import {
  getLlmCompletionText,
  isLlmAvailable,
  llmChatCompletion,
  parseLlmMessageContent,
} from '../llmClient.js'
import { MAX_TOPIC_RECOMMENDATIONS } from './constants.js'
import { mergeRecommendCards, topRecommendCards } from './recommendTopics.js'

function compactCandidate(card) {
  return {
    id: card.id,
    type: card.type,
    title: card.title,
    sampleSize: card.sampleSize,
    negative: card.negative,
    monthCounts: card.monthCounts,
    sourceTypes: card.sourceTypeLabels || card.sourceTypes,
    products: (card.products || []).slice(0, 6),
    scenarios: card.scenarioLabels || card.scenarios,
    quotes: (card.evidenceQuotes || []).slice(0, 3).map((quote) => quote.text),
  }
}

/**
 * 将 LLM 输出落到规则候选上：只能引用已有 id，合并后重算统计。
 * @param {object[]} candidates
 * @param {{ cards?: object[] } | null | undefined} parsed
 * @param {{ max?: number }} [options]
 */
export function applyLlmRecommendResult(candidates, parsed, options = {}) {
  const max = options.max ?? MAX_TOPIC_RECOMMENDATIONS
  const byId = new Map((candidates || []).map((card) => [card.id, card]))
  const used = new Set()
  const out = []
  for (const row of parsed?.cards || []) {
    const id = String(row?.id || '').trim()
    if (!id || !byId.has(id) || used.has(id)) continue
    const mergeIds = (Array.isArray(row.mergeIds) ? row.mergeIds : [])
      .map((item) => String(item || '').trim())
      .filter((item) => item && item !== id && byId.has(item) && !used.has(item))
    used.add(id)
    mergeIds.forEach((item) => used.add(item))
    const sourceCards = [byId.get(id), ...mergeIds.map((item) => byId.get(item))]
    let card = sourceCards.length > 1 ? mergeRecommendCards(sourceCards) : { ...byId.get(id) }
    if (!card) continue
    const intro = String(row.intro || '').trim()
    const whyNow = String(row.whyNow || '').trim()
    if (intro) card.intro = intro
    if (whyNow) card.whyNow = whyNow
    card.llmPolished = true
    out.push(card)
    if (out.length >= max) break
  }
  if (!out.length) return topRecommendCards(candidates, max)
  return out
}

/**
 * @param {object[]} candidates
 * @param {object} [settings]
 * @returns {Promise<object[] | null>}
 */
export async function polishRecommendationsWithLlm(candidates, settings) {
  if (!isLlmAvailable(settings) || !candidates?.length) return null
  const payload = candidates.map(compactCandidate)
  const data = await llmChatCompletion(settings, {
    temperature: 0.2,
    max_tokens: 4000,
    messages: [
      {
        role: 'system',
        content:
          '你是云产品体验分析师。只根据给定候选专题做排序、合并相似项、改写简介与推荐理由。输出 JSON：{"cards":[{"id":"...","mergeIds":[],"intro":"...","whyNow":"..."}]}。id 与 mergeIds 必须来自输入。禁止编造新专题、工单、客户或数字。最多 20 张。每条 intro/whyNow 各 1-2 句。',
      },
      {
        role: 'user',
        content: JSON.stringify({ candidates: payload }),
      },
    ],
  })
  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  if (!parsed || !Array.isArray(parsed.cards) || !parsed.cards.length) return null
  return applyLlmRecommendResult(candidates, parsed)
}
