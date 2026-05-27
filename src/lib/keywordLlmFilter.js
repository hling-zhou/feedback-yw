import { textForKeywordExtraction } from './keywordExtraction.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from './llmClient.js'
import {
  isNegativeSentiment,
  normalizeSentiment,
  SENTIMENT_LABELS,
} from './sentiment.js'
import { canUseSemanticMatch } from './themeSemantic.js'

const DEFAULT_MODEL = 'gpt-4o-mini'

/**
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 */
export function buildKeywordAnalysisContext(feedbacks) {
  const total = feedbacks?.length || 0
  const negative = (feedbacks || []).filter((fb) => isNegativeSentiment(fb.sentiment)).length
  const products = [
    ...new Set((feedbacks || []).map((fb) => fb.product || fb.productSpec).filter(Boolean)),
  ].slice(0, 6)

  return {
    sampleCount: total,
    negativeCount: negative,
    negativePct: total ? Math.round((negative / total) * 100) : 0,
    productHint: products.join('、') || '未标注',
  }
}

/**
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 * @param {number} [max]
 */
export function buildKeywordSampleLines(feedbacks, max = 8) {
  return (feedbacks || [])
    .map((fb) => {
      const text = textForKeywordExtraction(fb)
      if (!text?.trim()) return null
      const mood = SENTIMENT_LABELS[normalizeSentiment(fb.sentiment)] || '未知'
      const product = fb.product || fb.productSpec || '—'
      return `[情绪:${mood}][产品:${product}] ${text.slice(0, 380)}`
    })
    .filter(Boolean)
    .slice(0, max)
}

/**
 * @param {{ word: string; count: number }[]} candidates
 * @param {string[]} sampleLines
 * @param {ReturnType<typeof buildKeywordAnalysisContext>} [context]
 */
export function buildKeywordFilterPrompts(candidates, sampleLines, context) {
  const wordLines = candidates
    .map((c, i) => `${i + 1}. ${c.word}（出现 ${c.count} 次）`)
    .join('\n')

  const samples = (sampleLines || []).join('\n\n')
  const ctx = context || { sampleCount: 0, negativePct: 0, productHint: '—' }

  const systemPrompt = `你是移动云产品洞察分析助手。请对「候选高频词」做产品规划视角的校验筛选。

## 筛选目标（必须满足才有保留价值）
保留的词应能支撑产品规划与改进决策，帮助回答：
1. **问题集中在哪里**：用户反馈主要落在哪些产品能力、故障现象、使用场景（如带宽、连通性、开通、计费等）
2. **用户诉求是什么**：用户希望达成什么、抱怨什么卡点（扩容、删除资源、无法访问、降费等）
3. **情绪与紧迫度**：是否与不满、焦急、投诉等情绪相关（可结合样例中的情绪标签判断）

## 必须剔除（不要放入 keep）
- 礼貌用语、流程套话（谢谢、协助请求、预处理、归档、核实、回访等）
- 客服转单/代办话术（如「麻烦客服老师将工单转给后台技术老师帮忙删除资源」及片段）
- 工单流转/协办/处理人信息（不涉及、协办、处理人、云技术专家核实、派单、认领、挂起、关单、专家核实等）
- 工单字段/表单标签（联系电话、追加时间、追加内容、工单标题、流水号等）
- 无分析价值的泛化词：**测试、客户侧、用户侧、厂商侧、平台侧、系统、接口、日志** 等
- 孤立协议/单位/标识：**ipv、ipv4、ipv6、ip、Mbps、Gbps** 等（除非与具体故障描述绑定且能体现问题焦点）
- UUID、编号、联系方式、纯技术枚举项

## 保留示例（方向参考，须来自候选列表原文）
- 带宽不足、无法访问、丢包、开通失败、计费异常、跨省链路、退订失败、连接中断

只返回 JSON：{"keep":["词1","词2",...]}
- keep 仅包含候选列表中的原文，不要改写、不要新增
- 按对产品决策的价值从高到低排序，最多保留 ${Math.min(candidates.length, 24)} 个
- 若全部无价值，返回 {"keep":[]}`

  const userPrompt = `数据概况：共 ${ctx.sampleCount} 条反馈，负面/焦急占比约 ${ctx.negativePct}%（${ctx.negativeCount ?? 0} 条），涉及产品：${ctx.productHint}

候选高频词：
${wordLines || '（无）'}

客户问题样例（含情绪与产品，供理解语境）：
${samples || '（无样例）'}`

  return { systemPrompt, userPrompt }
}

/**
 * @param {string[]} keep
 * @param {{ word: string; count: number }[]} candidates
 */
export function applyKeywordKeepList(keep, candidates) {
  const allowed = new Set((keep || []).map((w) => String(w).trim()).filter(Boolean))
  if (!allowed.size) return []
  return candidates.filter((c) => allowed.has(c.word))
}

/**
 * LLM 校验候选高频词（产品规划视角）；失败时回退本地候选
 * @param {{ word: string; count: number }[]} candidates
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 * @param {import('./storage.js').AppSettings} settings
 * @param {number} [limit]
 */
export async function filterKeywordsWithLlm(candidates, feedbacks, settings, limit = 24) {
  if (!candidates.length) return []
  if (!canUseSemanticMatch(settings)) {
    return candidates.slice(0, limit)
  }

  const context = buildKeywordAnalysisContext(feedbacks)
  const sampleLines = buildKeywordSampleLines(feedbacks, 8)
  const { systemPrompt, userPrompt } = buildKeywordFilterPrompts(
    candidates,
    sampleLines,
    context,
  )

  try {
    const data = await llmChatCompletion(settings, {
      model: settings.llmModel || DEFAULT_MODEL,
      temperature: 0.15,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })

    const parsed = parseLlmMessageContent(getLlmCompletionText(data))
    const keep = Array.isArray(parsed.keep)
      ? parsed.keep
      : Array.isArray(parsed.words)
        ? parsed.words
        : Array.isArray(parsed.results)
          ? parsed.results.filter((r) => r.keep !== false).map((r) => r.word)
          : []

    const filtered = applyKeywordKeepList(keep, candidates)
    if (filtered.length > 0) return filtered.slice(0, limit)

    console.warn('[keywordLlmFilter] LLM 未保留任何词，回退本地列表')
    return candidates.slice(0, limit)
  } catch (err) {
    console.warn('[keywordLlmFilter] LLM 校验失败，回退本地列表:', err)
    return candidates.slice(0, limit)
  }
}
