/**
 * API 巡检诊断建议 LLM 生成器（11-17 拍板：诊断结果五段之「处理建议」）。
 * 输入：诊断结论 + 失败日志文本 + 根因分类 → 输出：1-3 句可执行处理建议。
 * 未配置/失败 → 返回 null（前端显示 —，不阻塞诊断主链）。
 */
import { resolveLlmApiKey, resolveLlmBaseUrl, resolveLlmModel } from './llmConfig.js'
import { forwardLlmChatCompletion } from './llmProxy.js'
import { getLlmCompletionText } from '../src/lib/llmClient.js'

const SYSTEM_PROMPT = `你是云平台 API 运维专家。基于失败的诊断结论与日志，给产品/运维侧写处理建议。
要求：
1. 1-3 句话，中文，可执行（如"建议排查X""需人工确认Y""属客户侧操作问题可引导Z"）。
2. 基于给定信息，禁止编造日志中不存在的事实。
3. 直接输出建议文本，不要任何前后缀、标题或引号。
面向对象是内部产品运营人员（不是最终客户），口吻专业简洁。`

/**
 * @param {string} conclusion 诊断结论
 * @param {string} logText 失败日志文本（extractDiagnosticText 产出）
 * @param {string} rootCauseL1 根因大类
 * @param {{ llm?: { apiKey?: string, baseUrl?: string, model?: string, forward?: typeof forwardLlmChatCompletion } }} [deps] 测试注入
 * @returns {Promise<string | null>} 建议文本；null = 未生成（未配置/失败/空输入）
 */
export async function generateDiagnosisSuggestion(conclusion, logText, rootCauseL1, deps = {}) {
  const c = String(conclusion || '').trim()
  const l = String(logText || '').trim()
  if (!c && !l) return null
  /** @type {string} */
  let apiKey
  try {
    apiKey = deps.llm?.apiKey || resolveLlmApiKey()
  } catch {
    return null
  }
  const forward = deps.llm?.forward || forwardLlmChatCompletion
  try {
    const body = {
      model: deps.llm?.model || resolveLlmModel(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `根因分类：${rootCauseL1 || '未分类'}\n诊断结论：${c || '（无明确结论）'}\n失败日志摘录：\n${l.slice(0, 600)}` },
      ],
      temperature: 0.3,
      max_tokens: 300,
    }
    const res = await forward({
      baseUrl: deps.llm?.baseUrl || resolveLlmBaseUrl(),
      apiKey,
      body,
      timeoutMs: 15_000,
    })
    const text = String(getLlmCompletionText(res?.data || res) || '').trim()
    if (!text || /^null$/i.test(text)) return null
    return text.slice(0, 500)
  } catch {
    return null
  }
}
