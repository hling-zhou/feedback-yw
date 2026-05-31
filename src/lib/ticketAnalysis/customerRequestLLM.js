import { canUseSemanticMatch } from '../themeSemantic.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from '../llmClient.js'
import {
  CUSTOMER_REQUEST_HARD_MAX,
  truncateCustomerRequest,
} from './customerRequestExtract.js'
import { isFormattedTemplateContent, isInternalCsBackendText } from './customerRequestFilters.js'

const DEFAULT_MODEL = 'gpt-4o-mini'

/**
 * @param {string} text
 */
export function isValidLlmCustomerRequest(text) {
  const t = truncateCustomerRequest(text)
  if (!t || t.length < 4) return false
  if (isFormattedTemplateContent(t)) return false
  if (isInternalCsBackendText(t) && t.length < 16) return false
  if (/请求节点[：:].*工单标题[：:]/.test(t)) return false
  return t.length <= CUSTOMER_REQUEST_HARD_MAX
}

/**
 * @param {Object} input
 * @param {string} input.taggingText
 * @param {import('./customerRequestExtract.js').CustomerRequestCandidate[]} [input.candidates]
 * @param {string} [input.ruleFallback]
 * @param {import('../storage.js').AppSettings} settings
 * @returns {Promise<string>}
 */
export async function extractCustomerRequestWithLLM(input, settings) {
  if (!canUseSemanticMatch(settings)) return ''

  const taggingText = (input.taggingText || '').slice(0, 4000)
  const candidatesBlock = (input.candidates || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c, i) => `${i + 1}. [phase ${c.phase}] ${c.text}`)
    .join('\n')

  const systemPrompt = `你是云计算客户体验分析师。从工单全生命周期文本中提取「客户请求内容」精炼摘要。

规则：
1. 综合受理、协办、反馈、追加等所有环节中客户主动表达的诉求，不是照搬首次原话。
2. 多轮表述优先级：客户明确修正 > 严重性最高（故障>性能>咨询）> 最新未解决描述 > 最完整。
3. 删除内部流转话术、格式化前缀、情绪词与重复感谢；保留时间条件、频次、资源类型等诊断信息。
4. 多个 IP/ID 可概括为「多台云主机」「N 条专线」等，勿丢失关键业务信息。
5. 咨询类用「咨询…」「申请…」句式；体验类客观描述界面/流程问题。
6. 必须基于工单事实，严禁臆测。
7. 输出 ≤80 字，必要时最长 ${CUSTOMER_REQUEST_HARD_MAX} 字。
8. 只返回 JSON：{"customerRequest":"..."}`

  const userPrompt = `规则层候选（按出现顺序）：
${candidatesBlock || '（无）'}

规则 fallback：${input.ruleFallback || '（空）'}

工单正文（受理/处理/追加）：
${taggingText}

请输出客户请求内容精炼摘要。`

  const data = await llmChatCompletion(settings, {
    model: settings.llmModel || DEFAULT_MODEL,
    temperature: 0.1,
    max_tokens: 256,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const raw =
    typeof parsed.customerRequest === 'string' ? parsed.customerRequest.trim() : ''
  if (!isValidLlmCustomerRequest(raw)) return ''
  return truncateCustomerRequest(raw)
}
