import { canUseSemanticMatch } from '../themeSemantic.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from '../llmClient.js'

/** 问题原因硬上限（与 rootCause 列一致：300，但 LLM 输出应远短） */
export const ROOT_CAUSE_HARD_MAX = 60
/** 问题原因最短长度（允许「安全策略」「硬件问题」等 4 字三级标签） */
export const ROOT_CAUSE_MIN_LEN = 4

/** 组织归责一/二级标签（禁止作为问题原因输出） */
const ORG_BLAME_RE =
  /云能问题|产品原因|运维原因|计算部原因|客户体验类|客户原因|服务问题|业务原因|网络原因|安全原因/

/** 占位/未定位 */
const PLACEHOLDER_RE =
  /^(?:无|暂无|未知|未提供|待补充|待分析|无法复现|根因未明|问题定位中|不涉及|n\/a|na|—|-+|\.+|\\+|\/+)$/i

/** 终判路径拼接（如「云能问题 / 产品原因 / 计算部原因」或去空格） */
const TREE_PATH_RE =
  /^(?:云能问题|产品原因|运维原因|计算部原因|客户体验类|客户原因)(?:\s*\/\s*(?:云能问题|产品原因|运维原因|计算部原因|客户体验类|客户原因|硬件问题|安全策略|性能问题|功能缺陷|配置问题|操作问题|流程问题|服务问题))*$/

/**
 * 从 LLM JSON 取问题原因。模型常按提示词中文回 `问题原因`/`根因`，不能只认 rootCause。
 * @param {Record<string, unknown> | null | undefined} parsed
 * @returns {string}
 */
export function pickLlmRootCauseField(parsed) {
  if (!parsed || typeof parsed !== 'object') return ''
  for (const key of ['rootCause', '问题原因', '根因', 'cause']) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * 是否为可用的 LLM 问题原因文本
 * @param {string} text
 */
export function isValidLlmRootCause(text) {
  const t = (text || '').trim()
  if (!t || t.length < ROOT_CAUSE_MIN_LEN) return false
  if (t.length > ROOT_CAUSE_HARD_MAX) return false
  if (PLACEHOLDER_RE.test(t)) return false
  // 禁止整段是组织归责
  if (ORG_BLAME_RE.test(t) && t.length <= 12) return false
  // 禁止整段是终判路径拼接
  if (TREE_PATH_RE.test(t)) return false
  return true
}

/**
 * 规范化问题原因：去前缀、去「原因是」引导、截断
 * @param {string} text
 */
export function truncateRootCause(text) {
  let t = (text || '').trim()
  if (!t) return ''
  // 去掉「问题原因】」「问题原因：」「根因：」「原因是」等前缀
  t = t
    .replace(/^问题原因[】\]+]*[：:]\s*/i, '')
    .replace(/^根因[（(]?必填[）)]?[：:]\s*/i, '')
    .replace(/^根因[：:]\s*/i, '')
    .replace(/^原因[】\]+]*[：:]\s*/i, '')
    .replace(/^原因是[:：]?\s*/i, '')
    .replace(/^[【\[]*问题原因[】\]+]*[:：]\s*/i, '')
    .trim()
  // 取第一分句，避免 LLM 输出多句
  const firstClause = t.split(/[。；;\n]/)[0]?.trim() || t
  if (firstClause.length >= ROOT_CAUSE_MIN_LEN) t = firstClause
  if (t.length > ROOT_CAUSE_HARD_MAX) t = t.slice(0, ROOT_CAUSE_HARD_MAX)
  return t
}

/**
 * 用 LLM 从工单文本中提取「问题原因」：导致表象的可核对配置/组件/流程状态。
 *
 * 不写客户感受（painPoint 已覆盖）、不写责任归属（投诉原因一/二级）、不写处置（solutionSummary）。
 * 证据不足时输出「工单未定位到具体问题原因」。
 *
 * @param {Object} input
 * @param {string} input.taggingText
 * @param {string} [input.handlingText]
 * @param {string} [input.rootCause] 规则/导入已有值（参考）
 * @param {string} [input.painPoint] 表象（参考，避免复述）
 * @param {import('../storage.js').AppSettings} settings
 * @returns {Promise<string>}
 */
export async function extractRootCauseWithLLM(input, settings) {
  if (!canUseSemanticMatch(settings)) return ''

  const taggingText = (input.taggingText || '').slice(0, 4000)
  const handlingText = (input.handlingText || '').slice(0, 2000)
  const painPoint = (input.painPoint || '').slice(0, 120)
  const existingRootCause = (input.rootCause || '').slice(0, 200)

  const systemPrompt = `你是云计算运维与产品体验分析师。从单条工单中提取「问题原因」。

问题原因指：导致客户遇到表象的具体、可核对的配置、组件或流程状态。它是产品优化的下手点。

层级区分（必须遵守）：
- 表象（不写这里）：客户遇到了什么，如「云主机 SSH 连不上」。
- 问题原因（写这里）：哪个配置/组件/流程状态导致了它，如「安全组未放行 22 端口」。
- 责任归属（禁止输出）：如「云能问题」「产品原因」「计算部原因」「运维原因」「客户体验类」。
- 处置（禁止输出）：客服做了什么，如「已建群」「已协助放行」。

规则：
1. 证据优先级：处理意见/解决方案/正文里的「根因/定位为/经排查」> 受理内容中的客观排查结论 > 导入列已有问题原因（仅参考）。
2. 只写工单里能核对到的条件，禁止臆测未出现的组件或原因。
3. 证据不足时输出「工单未定位到具体问题原因」，不要编造。
4. 禁止输出一/二级组织归责（云能问题/产品原因/计算部原因/运维原因/客户体验类/客户原因）。
5. 若工单明确落到投诉原因树，最多写三级（如「安全策略」「硬件问题」），不得停在一/二级。
6. 一句中文，约 8-40 字，尽量写成「{问题原因}导致{可选短表象}」。
7. 不要复述客户痛点（painPoint），要比它更靠近成因一层。
8. 只返回 JSON：{"rootCause":"..."}

示例：
- 客户说「公网不通」+ 处理意见「安全组 80 未开」→ {"rootCause":"安全组未放行 80 端口"}
- 客户说「公网不通」+ 处理意见「EIP 未绑定云主机」→ {"rootCause":"弹性公网 IP 未绑定到云主机"}
- 客户说「公网不通」+ 处理意见「异网」→ {"rootCause":"异网访问拥塞"}
- 只有「云能问题 / 产品原因 / 计算部原因」无机制句 → {"rootCause":"计算部原因"}
- 处理意见只有「已建群跟进」→ {"rootCause":"工单未定位到具体问题原因"}`

  const userPrompt = `客户痛点（表象，参考，勿复述）：${painPoint || '（未提取）'}

已有问题原因（导入/规则，仅参考，可覆盖）：${existingRootCause || '无'}

处理意见（重点证据）：
${handlingText || '（无）'}

工单正文（受理/处理/追加）：
${taggingText}

请输出问题原因。`

  const data = await llmChatCompletion(settings, {
    temperature: 0.1,
    max_tokens: 200,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const raw = pickLlmRootCauseField(parsed)
  if (!raw) return ''
  // 先清洗（去前缀、取首句、截断），再校验：避免带「问题原因：」前缀或稍长的有效成因
  // 被长度校验误杀，导致 LLM 已返回但 rootCause 不更新（页面仍显示旧值）。
  const cleaned = truncateRootCause(raw)
  if (!isValidLlmRootCause(cleaned)) return ''
  return cleaned
}
