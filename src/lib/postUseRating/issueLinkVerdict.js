import { getLlmCompletionText, llmChatCompletion } from '../llmClient.js'

/**
 * 11-23 拍板：回访/溯源 vs 原反馈的「关联具体问题」LLM 语义自动判定。
 *
 * 语义四值（与 link 表 verdict 值域一致）：
 * - related：本次回访/溯源处理/响应的正是该问题（问题存在）
 * - no_dissatisfaction：回访核实客户根本无实际不满（误操作/情绪分）——仅回访
 * - no_action：产品部评估无需优改（账户异常、极小概率场景等核实不成立）——溯源结论或回访内部评估
 * - uncertain：语义不足以判定——不写 link（留人工）
 *
 * 设计边界（与用户拍板对齐）：
 * - LLM 只判不造：verdict 只能取上述封闭值；对每个候选问题输出一句理由
 * - 报告消费语义不变：no_dissatisfaction → 档 1 全剔除；no_action → 档 2 半剔除
 *   （不进定性进定量）——由 reportEvidence 的既有 status 机制承接，本模块只做判定入口
 * - 来源标注：经本模块写入的 link verdictSource='llm'，人工修正覆盖后置 'manual'
 */

/** @typedef {{ id: string, issueName: string, text: string, score: number | null, month: string }} IssueCandidate */
/**
 * @param {{ sourceType: 'visit' | 'trace', sourceResult: string, sourceConclusion: string }} source
 * @param {IssueCandidate[]} issues
 */
export async function generateIssueLinkVerdicts(settings, source, issues) {
  if (!issues?.length) return { verdicts: [] }
  const sourceTypeLabel = source.sourceType === 'visit' ? '省代表回访' : '产品部溯源'
  const candidates = issues.map((issue, index) => ({
    index,
    issueName: issue.issueName,
    原话: issue.text,
    得分: issue.score,
    月份: issue.month,
  }))
  const system = `你是客服质量平台的回访/溯源结论核对员。给你一条${sourceTypeLabel}记录（回访/溯源结果与内部结论），以及同一客户当期的负反馈问题候选列表。对每个候选问题判断：${sourceTypeLabel}针对的正是该问题，还是核实后该问题不成立。

判定值（封闭清单，只选不造）：
- "related"：${sourceTypeLabel}处理/响应的正是该问题（问题存在）；
- "no_dissatisfaction"：客户经核实根本无实际不满（误操作/情绪分/误解）——仅当${sourceTypeLabel}结果明确表达客户无不满时使用；
- "no_action"：产品部评估无需优改（如账户异常、极小概率场景、客户自身环境问题——核实后问题不成立），客户可能有表述但核实不成立；
- "uncertain"：信息不足以判断（回访未提及该问题、语义模糊）。

只输出严格 JSON：{"verdicts":[{"index":0,"verdict":"related","reason":"一句理由"}…]}，index 对应输入候选顺序，verdict 只能取上述四值。不要 Markdown，不要解释。`

  const data = await llmChatCompletion(settings, {
    purpose: 'report',
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: JSON.stringify({
          [`${sourceTypeLabel}结果`]: source.sourceResult,
          内部结论: source.sourceConclusion,
          候选问题: candidates,
        }),
      },
    ],
    temperature: 0,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  })

  const parsed = parseVerdictPayload(data)
  if (!parsed) throw new Error('LLM 判定返回无法解析')
  const byIndex = new Map()
  for (const row of parsed.verdicts || []) {
    if (!row || typeof row.index !== 'number' || !issues[row.index]) continue
    const verdict = normalizeVerdict(row.verdict)
    if (!verdict) continue
    byIndex.set(row.index, { verdict, reason: String(row.reason || '').slice(0, 200) })
  }
  return {
    verdicts: issues.map((issue, index) => ({ issue, ...byIndex.get(index) || { verdict: 'uncertain', reason: '' } })),
  }
}

/** @returns {any | null} */
function parseVerdictPayload(data) {
  try {
    // 11-23 修复：复用平台既有 getLlmCompletionText（处理推理型模型 content 数组/
    // 思考草稿全部形态）——自写简化版在 content 为数组时 String() 成 [object Object]
    // 找不到 { 导致部署环境「LLM 判定返回无法解析」（共享层契约纪律先例）。
    const text = getLlmCompletionText(data)
    if (!text) return null
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function normalizeVerdict(value) {
  const verdict = String(value || '').trim().toLowerCase()
  return ['related', 'no_dissatisfaction', 'no_action', 'uncertain'].includes(verdict) ? verdict : null
}
