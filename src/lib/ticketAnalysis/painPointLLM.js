import { canUseSemanticMatch } from '../themeSemantic.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from '../llmClient.js'
import { truncatePainPoint, PAIN_POINT_HARD_MAX } from './painPointExtract.js'

const LEADING_PHRASE_RE =
  /^(?:用户(?:希望|建议|反馈|要求|反映|咨询)|客户(?:希望|建议|反馈|要求|反映)|请(?:帮忙|协助)|希望|建议)/

/**
 * @param {string} text
 */
export function isValidLlmPainPoint(text) {
  const t = truncatePainPoint(text)
  if (!t || t.length < 6) return false
  if (LEADING_PHRASE_RE.test(t)) return false
  if (/用户希望|用户建议|用户反馈|用户要求/.test(t)) return false
  return t.length <= PAIN_POINT_HARD_MAX
}

/**
 * @param {Object} input
 * @param {string} input.taggingText
 * @param {string} [input.customerRequest]
 * @param {string} [input.handlingText]
 * @param {string} [input.rootCause]
 * @param {import('../storage.js').AppSettings} settings
 * @returns {Promise<string>}
 */
export async function extractPainPointWithLLM(input, settings) {
  if (!canUseSemanticMatch(settings)) return ''

  const taggingText = (input.taggingText || '').slice(0, 4000)
  const customerRequest = (input.customerRequest || '').slice(0, 240)
  const rootCause = (input.rootCause || '').slice(0, 200)

  const systemPrompt = `你是云计算客户体验分析师。从工单文本中挖掘「需求痛点」。

规则：
1. 以「客户请求内容」为主输入，聚焦核心未满足诉求或问题本质；工单正文为辅，有效根因仅作参考。
2. 聚焦问题本质，不写表面操作细节；必须基于工单事实，严禁臆测。
3. 剥离纯情绪词，保留程度副词（如「非常慢」「持续卡顿」）。
4. 禁止以「用户希望/建议/反馈/要求」等引导语开头。
5. 需求类建议改写为客观陈述，如「希望批量删除」→「删除资源需逐个操作，效率低」。
6. 痛点应比客户请求更本质一层，且不得与之矛盾。
7. 输出一句简洁、完整、客观的中文陈述句，最长不超过 ${PAIN_POINT_HARD_MAX} 字。
8. 只返回 JSON：{"painPoint":"..."}

示例：
- 原话「希望增加批量删除」→「删除资源需逐个操作，效率低。」
- 原话「这个破系统太垃圾了，打开网页要等一分钟」→「云主机控制台页面加载需一分钟。」`

  const userPrompt = `客户请求内容（主输入）：${customerRequest || '（未提取）'}

有效根因（参考）：${rootCause || '无'}

工单正文（受理/处理/追加）：
${taggingText}

请输出需求痛点。`

  const data = await llmChatCompletion(settings, {
    temperature: 0.1,
    max_tokens: 256,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const raw = typeof parsed.painPoint === 'string' ? parsed.painPoint.trim() : ''
  if (!isValidLlmPainPoint(raw)) return ''
  return truncatePainPoint(raw)
}
