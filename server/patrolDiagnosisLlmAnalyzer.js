/**
 * API 巡检 LLM 结构化诊断分析器（11-17 拍板：LLM 主路径，规则引擎降级为兜底/加速）。
 *
 * 背景：分页缺失时代（只拿第 1 页）关键证据被截断，LLM 兜底分类只能看到入口 WARN 行，
 * 诚实判「诊断能力缺口」——根因不在 LLM 在输入。本模块在全量日志基础上让 LLM 产出
 * 五段结构化诊断（结论/直接原因/关键证据/处理建议 + 根因大类）。
 *
 * 主路径：规则引擎先做高置信初筛（命中即省一次 LLM 调用——加速路径）→
 *         未命中走 LLM 结构化分析（枚举选根因，只选不造）→
 *         LLM 失败/未配置 → 规则引擎兜底结果（五段结构化字段为空，由切分层降级）。
 *
 * 来源标注纪律：rootCauseSource 如实标注——llm=LLM 结构化分析产出 / rule=规则引擎产出；
 * 五段字段（conclusion/directCause/evidence/suggestion）为 null 表示 LLM 未产出（切分层降级）。
 */
import { resolveLlmApiKey, resolveLlmBaseUrl, resolveLlmModel } from './llmConfig.js'
import { forwardLlmChatCompletion } from './llmProxy.js'
import { getLlmCompletionText } from '../src/lib/llmClient.js'
import { LLM_ROOT_CAUSE_L1_OPTIONS } from './patrolRootCauseLlmClassifier.js'
import { cleanLogLine } from './patrolRootCauseClassifier.js'

/** LLM 输入预算（字符）——行级清洗后日志送 LLM 的总量上限。 */
const LLM_INPUT_CHAR_BUDGET = 24_000
/** 直接原因/关键证据行数上限。 */
const MAX_DIRECT_CAUSE_LINES = 8
const MAX_EVIDENCE_ITEMS = 10
/** LLM 单组最大尝试次数（11-17 拍板 3 次；11-18 拍板增至 5 次——所有组依赖 LLM 出结论后失败面变大，
 *  多给 2 次吸收瞬时网关/超时抖动；5 次仍失败视为未诊断，组保持 pending 明日重试）。 */
const LLM_MAX_ATTEMPTS = 5
/** 重试间隔基数（毫秒）——指数退避：1s、2s。 */
const LLM_RETRY_BASE_DELAY_MS = 1_000

/**
 * 从 MCP 合成响应提取日志行，按诊断价值分层：
 * 高价值 = ERROR/WARN/FATAL 级 + 告警/异常/失败语义行 + 尾部 30 行（证据常在尾部——11-17 实测失败点在页 3 尾）。
 * @param {string} mcpText fetchPatrolDiagnosticLogs 合成响应文本（{code:'0000',data:{records}}）
 * @returns {{ ok: boolean, lines: string[], rawCount: number }} ok=false = 非 JSON 形态或无行
 */
export function extractLogLinesForLlm(mcpText) {
  /** @type {{ code?: string, data?: { records?: Array<{ content?: string }> } } | null} */
  let parsed = null
  try {
    parsed = JSON.parse(String(mcpText || ''))
  } catch {
    return { ok: false, lines: [], rawCount: 0 }
  }
  if (parsed?.code !== '0000' || !Array.isArray(parsed?.data?.records)) {
    return { ok: false, lines: [], rawCount: 0 }
  }
  const raw = parsed.data.records.map((r) => String(r?.content || '').trim()).filter(Boolean)
  if (raw.length === 0) return { ok: true, lines: [], rawCount: 0 }

  const isErrLevel = (l) => /\[\s*(ERROR|WARN|FATAL)\s*\]/.test(l)
  const isSemantic = (l) => /告警|异常|失败|Exception|error|ErrorCode|errorMessage|冲突|拒绝|不存在|超时|黑名单|拦截/i.test(l)

  const errLines = raw.filter(isErrLevel)
  const semantic = raw.filter((l) => !isErrLevel(l) && isSemantic(l))
  const tail = raw.slice(-30)
  // 分层合并去重，保持时间序稳定：错误级 → 语义行 → 尾部（后两层只补不重复的）
  /** @type {string[]} */
  const picked = [...errLines]
  const seen = new Set(errLines)
  for (const l of semantic) { if (!seen.has(l)) { picked.push(l); seen.add(l) } }
  for (const l of tail) { if (!seen.has(l)) { picked.push(l); seen.add(l) } }
  return { ok: true, lines: picked, rawCount: raw.length }
}

/**
 * LLM 结构化诊断 system prompt（五段 + 根因大类枚举）。
 * 根因大类只选不造（与规则表 L1 值域一致——归类统一既有枚举，11-17 用户拍板）。
 */
const SYSTEM_PROMPT = `你是云平台 API 失败诊断专家。基于给定失败请求的完整日志，输出结构化诊断报告（严格 JSON）。

要求：
1. 只输出一个 JSON 对象，无任何其他文字、无 markdown 代码块标记。
2. 字段定义：
   - "conclusion"：1-3 句中文诊断结论（发生了什么、为什么失败、是否平台故障）。
   - "directCause"：字符串数组，最关键的失败原始日志行（原文摘录，每条 ≤300 字，最多 8 条，按时间序）。
   - "evidence"：字符串数组，支撑结论的关键证据句（清洗后语义，每条 ≤200 字，最多 10 条）。
   - "suggestion"：1-3 句可执行处理建议（面向内部产品运营/运维，基于日志事实，禁止编造）。
   - "rootCauseL1"：根因大类，从枚举中选一个：${LLM_ROOT_CAUSE_L1_OPTIONS.join(' | ')}。
   - "rootCauseL2"：根因细分场景，4-16 字短语（LLM 自主生成——描述具体失败场景，如「网卡操作进行中」「订单已是终态」「RAM 子用户无此操作权限」；不得是「LLM判断」类来源标注）。
   - "needsProductAction"：布尔，产品侧是否需要跟进处理（判定依据见第 4 条）。
   - "actionReason"：一句话判定理由（≤50 字，说明为何需要/不需要产品侧处理）。
3. rootCauseL1 类目边界（判定顺序）：
   - 【第一优先级】若日志提取到平台错误码（errorCode=CSLOPENSTACK_XXX 等），优先以错误码语义判类：码名自带业务语义（如 BIZ_IN_LOCK_OPERATE=锁定中、NOT_FOUND=资源不存在、INVALID_XXX_PARAM=参数无效、QUOTA=配额、FORBIDDEN=权限拒绝），须结合对应 errorMessage 佐证后归属；
   - 资源锁定 vs 资源状态边界：IN_OPERATION/IN_LOCK/OPERATING 类（操作进行中，稍后可重试）= 资源锁定/并发冲突；NOT_FOUND/非ACTIVE/状态不满足类（实例状态本身不对，重试也没用）= 资源状态异常或参数无效（资源不存在）；
   - 诊断能力缺口——日志只有正常调用/框架日志，看不出失败原因；
   - 参数无效/校验失败——请求侧传参不过校验（必填、格式、取值、业务规则校验拒绝）；
   - 配额不足——数量/额度上限；
   - 资源锁定/并发冲突——瞬时占用，稍后重试可能成功；
   - 资源状态异常——单资源实例状态不满足，不改状态必失败；
   - 业务冲突——产品级业务规则对一类操作的限制（如网段冲突、不支持的操作组合、绑定关系冲突）；
   - 其他/未归类——确实无法判断时选这个，禁止编造。
4. needsProductAction 判定边界（11-18 拍板）：
   - false（不需产品侧处理）：①日志已明确失败原因是并发/操作进行中（如 is operating、in operation、正在执行、并发、锁定中、稍后重试类拒绝）——这是资源正常占用机制，直接判 false；②失败由客户侧使用方式导致（传参错误、配额用尽、无权限操作、重复提交、资源被自己占用、主动解绑未绑定的资源等）；③瞬时并发冲突稍后重试可成功且日志无平台异常迹象——以上皆产品侧无 bug 可修，客户稍后重试或自查；
   - true（需产品侧处理）：疑似产品缺陷、平台故障、资源状态机异常、锁定机制缺陷（长时间锁定不释放）、能力不支持导致客户合理操作失败、错误信息误导客户——产品侧需要跟进修复、评估或改进提示。
5. 日志里没有的信息不许编造；判断不了的字段用空数组/空串；needsProductAction 判断不了时取 true（保守）。`

/**
 * LLM 结构化诊断主函数。
 * 11-17 用户拍板：LLM 失败自动重试（最多 3 次尝试，指数退避）；3 次全失败 →
 * byLlm=false 且 llmFailed=true，调用方须视为「未诊断」（组保持 pending，不推垃圾分类）。
 * @param {string} mcpText fetchPatrolDiagnosticLogs 合成响应原文（全量日志）
 * @param {{ apiPath?: string, poolName?: string, userName?: string, productKey?: string }} groupCtx 组上下文
 * @param {{ llm?: { apiKey?: string, baseUrl?: string, model?: string, forward?: typeof forwardLlmChatCompletion }, onRetry?: (attempt: number, reason: string) => void }} [deps] 测试注入/重试回调
 * @returns {Promise<{ ok: boolean, byLlm: boolean, llmFailed: boolean, attempts: number, conclusion: string | null, directCause: string[], evidence: string[], suggestion: string | null, rootCauseL1: string | null }>}
 *   ok=false = 输入不可分析；byLlm=false = LLM 未产出；llmFailed=true = LLM 尝试 3 次全失败（调用方视为未诊断）
 */
/**
 * 提取日志中的平台错误码清单（11-18 拍板：错误码作为结构化信号显式喂给 LLM 现场判类——
 * 不预维护白名单，错误码是产品自身命名、语义稳定，LLM 结合 errorMessage 判归属）。
 * 形态：errorCode=CSLOPENSTACK_XXX；去重保序；无错误码返回空数组。
 * @param {string} text
 * @returns {string[]}
 */
export function extractErrorCodes(text) {
  const t = String(text || '')
  const codes = []
  const seen = new Set()
  for (const m of t.matchAll(/errorCode=([A-Z][A-Z0-9_]{6,})/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); codes.push(m[1]) }
  }
  return codes
}

export async function analyzeFailureByLlm(mcpText, groupCtx = {}, deps = {}) {
  const EMPTY = { conclusion: null, directCause: [], evidence: [], suggestion: null, rootCauseL1: null, rootCauseL2: null, needsProductAction: true, actionReason: null }
  const { ok, lines, rawCount } = extractLogLinesForLlm(mcpText)
  if (!ok || rawCount === 0 || lines.length === 0) {
    return { ok: false, byLlm: false, llmFailed: false, attempts: 0, ...EMPTY }
  }
  // 行级清洗 + 预算裁剪（超长行截 600 字；总预算内从尾部优先保留——证据密度尾部高）
  const cleaned = lines.map((l) => (l.length > 600 ? l.slice(0, 600) + '…' : l))
  /** @type {string[]} */
  let budgeted = []
  let used = 0
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const cost = cleaned[i].length + 1
    if (used + cost > LLM_INPUT_CHAR_BUDGET && budgeted.length > 0) break
    budgeted.unshift(cleaned[i])
    used += cost
  }

  /** @type {string} */
  let apiKey
  try {
    apiKey = deps.llm?.apiKey || resolveLlmApiKey()
  } catch {
    // 未配置 LLM：不算失败重试（无 LLM 环境是合法状态，直接走规则引擎）
    return { ok: true, byLlm: false, llmFailed: false, attempts: 0, ...EMPTY }
  }
  const forward = deps.llm?.forward || forwardLlmChatCompletion
  const ctx = [
    groupCtx.apiPath ? `接口：${groupCtx.apiPath}` : '',
    groupCtx.poolName ? `资源池：${groupCtx.poolName}` : '',
    groupCtx.userName ? `客户：${groupCtx.userName}` : '',
  ].filter(Boolean).join(' · ')
  // 11-18 拍板：全量日志提取错误码清单显式喂给 LLM（裁剪预算可能把含码行裁掉——错误码是最高价值信号）
  const errorCodes = extractErrorCodes(mcpText)
  const ecLine = errorCodes.length > 0
    ? `本次日志提取到的平台错误码（errorCode，判类第一优先级信号，须结合对应 errorMessage 判断归属）：\n${errorCodes.join('\n')}`
    : '本次日志未提取到平台错误码。'
  const userContent = `失败请求上下文：${ctx || '（无）'}\n${ecLine}\n日志共 ${rawCount} 行（已按诊断价值挑选 ${budgeted.length} 行，时间序）：\n${budgeted.join('\n')}`

  /** 单次尝试：调 LLM → 解析 JSON → 枚举匹配。返回 null = 本次失败（可重试）。 */
  const attemptOnce = async () => {
    const body = {
      model: deps.llm?.model || resolveLlmModel(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0,
      // 11-18 实证：推理型模型 reasoning 与正文共享 max_tokens 预算——共享默认 2048 下
      // 复杂组推理吃光预算（实测最坏组 #183 reasoning=3748 + 正文≈1846 字 → completion=4687），
      // 正文 0 字或 JSON 半途截断 → 解析必败且 temperature=0 重试同型 3 连败。
      // 8192 为实测安全值（最坏组 finish_reason=stop）。
      max_tokens: 8192,
    }
    const res = await forward({
      baseUrl: deps.llm?.baseUrl || resolveLlmBaseUrl(),
      apiKey,
      body,
      // 11-18 实证：max_tokens 8192 修复截断后，推理型模型充分推理生成时长变长
      //（实测吞吐 ~78 tok/s，8192 tokens 封顶 ≈ 105s），旧 60s 超时按 2048 预算时代
      // 标定，正卡在生成时长边上——#214 首跑超时、重试翻身先例。超时与 token 预算
      // 联动：8192÷78 ≈ 105s 封顶 + 余量 → 120s。连接类错误即时返回不吃此预算，
      // 放宽只吸收「正常生成但慢」的形态，不放大网关挂的暴露面。
      timeoutMs: 120_000,
    })
    const answer = String(getLlmCompletionText(res?.data || res) || '').trim()
    // 剥 markdown 代码块包裹（LLM 常见行为）
    const jsonText = answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    /** @type {{ conclusion?: string, directCause?: string[], evidence?: string[], suggestion?: string, rootCauseL1?: string } | null} */
    let report = null
    try {
      report = JSON.parse(jsonText)
    } catch {
      // JSON 解析失败：尝试从文本中提取第一个 {...} 平衡块
      const start = jsonText.indexOf('{')
      if (start >= 0) {
        let depth = 0
        let end = -1
        for (let i = start; i < jsonText.length; i++) {
          if (jsonText[i] === '{') depth++
          else if (jsonText[i] === '}') { depth--; if (depth === 0) { end = i; break } }
        }
        if (end > start) {
          try { report = JSON.parse(jsonText.slice(start, end + 1)) } catch { report = null }
        }
      }
    }
    if (!report || typeof report !== 'object') return null
    // 根因大类严格枚举匹配（只选不造）
    let l1 = null
    const raw = String(report.rootCauseL1 || '')
    for (const opt of LLM_ROOT_CAUSE_L1_OPTIONS) {
      if (raw.includes(opt)) { l1 = opt; break }
    }
    const directCause = Array.isArray(report.directCause)
      ? report.directCause.map(String).filter(Boolean).slice(0, MAX_DIRECT_CAUSE_LINES)
      : []
    const evidence = Array.isArray(report.evidence)
      ? report.evidence.map(String).filter(Boolean).slice(0, MAX_EVIDENCE_ITEMS)
      : []
    const conclusion = String(report.conclusion || '').trim() || null
    const suggestion = String(report.suggestion || '').trim() || null
    // 11-18 拍板：L2 由 LLM 自主生成细分场景短语；needsProductAction 现场判定（保守默认 true）
    const rootCauseL2 = String(report.rootCauseL2 || '').trim().slice(0, 24) || null
    const needsProductAction = typeof report.needsProductAction === 'boolean' ? report.needsProductAction : true
    const actionReason = String(report.actionReason || '').trim().slice(0, 80) || null
    return {
      conclusion,
      directCause,
      evidence,
      suggestion,
      rootCauseL1: l1,
      rootCauseL2,
      needsProductAction,
      actionReason,
    }
  }

  // 最多 LLM_MAX_ATTEMPTS 次尝试，指数退避（1s、2s）
  /** @type {Awaited<ReturnType<typeof attemptOnce>> | null} */
  let result = null
  let attempts = 0
  let lastError = ''
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    attempts = attempt
    try {
      result = await attemptOnce()
      if (result) break
      lastError = 'LLM 输出不可解析为结构化 JSON'
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      result = null
    }
    if (attempt < LLM_MAX_ATTEMPTS) {
      deps.onRetry?.(attempt, lastError)
      await new Promise((r) => setTimeout(r, LLM_RETRY_BASE_DELAY_MS * attempt))
    }
  }

  if (!result) {
    // 3 次全失败：视为未诊断（调用方须保持组 pending、不推垃圾分类）
    return { ok: true, byLlm: false, llmFailed: true, attempts, ...EMPTY }
  }
  return {
    ok: true,
    byLlm: Boolean(result.conclusion || result.directCause.length || result.evidence.length || result.suggestion || result.rootCauseL1),
    llmFailed: false,
    attempts,
    conclusion: result.conclusion,
    directCause: result.directCause,
    evidence: result.evidence,
    suggestion: result.suggestion,
    rootCauseL1: result.rootCauseL1,
    rootCauseL2: result.rootCauseL2,
    needsProductAction: result.needsProductAction,
    actionReason: result.actionReason,
  }
}
