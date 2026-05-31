import { canUseSemanticMatch } from '../themeSemantic.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from '../llmClient.js'
import { isGenericMeasure } from '../journeyOptimizationLLM.js'

const DEFAULT_MODEL = 'gpt-4o-mini'

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeOptimizationList(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item && !isGenericMeasure(item))
}

/**
 * @param {string[]} items
 * @param {number} max
 */
function joinOptimizations(items, max) {
  return [...new Set(items)].slice(0, max).join('\n')
}

/**
 * @param {Object} input
 * @param {string} input.text
 * @param {string} [input.solutionSummary]
 * @param {string} [input.rootCause]
 * @param {string} [input.journeyL2]
 * @param {string} [input.painPoint]
 * @param {string} [input.requestScene]
 * @param {string} [input.problemType]
 * @param {boolean} [input.fuzzy]
 * @param {import('../storage.js').AppSettings} settings
 * @returns {Promise<{ optimizationProduct: string; optimizationService: string; optimizationSuggestion: string }>}
 */
export async function extractTicketOptimizationsWithLLM(input, settings) {
  if (!canUseSemanticMatch(settings)) {
    return { optimizationProduct: '', optimizationService: '', optimizationSuggestion: '' }
  }

  const text = (input.text || '').slice(0, 4000)
  const painPoint = (input.painPoint || '').slice(0, 120)
  const rootCause = (input.rootCause || '').slice(0, 200)
  const solutionSummary = (input.solutionSummary || '').slice(0, 300)

  const systemPrompt = `你是移动云产品体验优化专家。针对单条投诉/咨询工单，输出可落地的优化建议。

规则：
1. productOptimizations 必须至少 1 条：针对功能、交互、默认策略、报错提示或架构限制的具体改进。
2. serviceOptimizations 按需输出（无明确服务短板可不输出）：针对 SLA、跨组协同、催办机制、知识库或升级路径。
3. 每条 25～80 字，具体可执行，禁止「加强培训」「优化体验」「提升效率」「纳入规划」等空泛表述。
4. 不要复述工单临时规避操作，要提炼根本改进方向。
5. 只返回 JSON：{"productOptimizations":["..."],"serviceOptimizations":["..."]}`

  const userPrompt = `需求痛点：${painPoint || '未提取'}
问题类型：${input.problemType || '未分类'}
请求场景：${input.requestScene || '未分类'}
用户旅程二级：${input.journeyL2 || '未识别'}
有效根因：${rootCause || '无'}
处理结论：${solutionSummary || '无'}
内容是否模糊需路径兜底：${input.fuzzy ? '是' : '否'}

工单正文：
${text}

请输出单条工单的优化建议。`

  const data = await llmChatCompletion(settings, {
    model: settings.llmModel || DEFAULT_MODEL,
    temperature: 0.35,
    max_tokens: 768,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const product = normalizeOptimizationList(parsed.productOptimizations)
  const service = normalizeOptimizationList(parsed.serviceOptimizations)

  const optimizationProduct = joinOptimizations(product, 3)
  const optimizationService = joinOptimizations(service, 2)
  const optimizationSuggestion = [optimizationProduct, optimizationService].filter(Boolean).join('\n')

  return { optimizationProduct, optimizationService, optimizationSuggestion }
}
