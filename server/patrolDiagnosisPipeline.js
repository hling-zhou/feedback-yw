/**
 * API 巡检诊断编排管线（11-18 拍板：归类流程倒转——LLM 先产结论文本，归因规则表后定大类）。
 *
 * 旧流程（11-17）：规则引擎先初筛（命中=加速路径省 LLM）→ 未命中才 LLM——
 *   规则命中组 conclusion 落日志原文、evidence/direct_cause 全空（UI 明显质量断崖）。
 * 新流程（本模块，11-18 用户拍板「根因归类应基于 LLM 后的结论文本对照归因规则」）：
 *   ① 快速路径：无失败语义日志（extractDiagnosticText 空产出）→ 直接判「诊断能力缺口」，
 *      不烧 LLM 调用（正常调用日志是无信息输入，LLM 只会编造）。
 *   ② LLM 结构化分析：全部组都跑（五段：conclusion/directCause/evidence/suggestion）。
 *   ③ 归因规则表对「LLM 产物文本」匹配（结论+直接原因+证据拼接——directCause 是原文日志行
 *      摘录，规则表日志关键词（IS_LOCKING/正在执行等）仍可命中，保持规则表兼容面）——
 *      命中 → 规则 L1/L2 定类（规则表=归类真源，运营在 UI 维护）。
 *   ④ 未命中 → LLM 枚举判断兜底定 L1（l2=LLM结构化诊断，strictLabels 只选不造）。
 *   ⑤ 降级：LLM 未配置（合法状态）/未产出 → 旧链路（规则对日志原文），结论=原文，源=rule。
 *
 * root_cause_source 值域不变（llm/rule/null）：llm=五段为 LLM 结构化产物（含规则定类组——
 * 类是规则定的，五段是 LLM 产的，标注只描述五段产出方）；rule=降级链路产物。
 *
 * 失败语义（11-17 拍板沿袭）：llmFailed=true（3 次重试全败）→ 调用方视为「未诊断」——
 * 保持组 pending、不落库、不推垃圾分类（明日跑批自然重试）。
 */
import { analyzeFailureByLlm } from './patrolDiagnosisLlmAnalyzer.js'
import { classifyPatrolRootCause, extractDiagnosticText } from './patrolRootCauseClassifier.js'

/**
 * LLM 产物文本 → 规则表分类输入（11-18 拍板口径：基于 LLM 结论文本对照规则）。
 * 只取结论（LLM 语义产物）；结论空时退证据句（同为 LLM 清洗语义）。
 * 【排除 directCause——真实链路实证（#288）】：directCause 是原始日志行摘录，
 * 同一请求的日志常含其他校验阶段的关键词（如 RAM 鉴权失败组的日志行里混着
 * 「IPv4地址不存在」），拼进分类文本会让规则表被日志噪声劫持、归错大类
 * （实测：结论明说 RAM 鉴权拒绝，规则却判「参数无效/校验失败」）。
 * @param {{ conclusion: string | null, evidence: string[] }} llmReport
 * @returns {string}
 */
function buildClassificationText(llmReport) {
  const conclusion = String(llmReport.conclusion || '').trim()
  if (conclusion) return conclusion
  return (Array.isArray(llmReport.evidence) ? llmReport.evidence : []).filter(Boolean).join('；')
}

/**
 * 诊断编排管线主函数（MCP 日志原文 → { 分类, 五段, 来源, 失败语义 }）。
 *
 * @param {string} mcpText fetchPatrolDiagnosticLogs 合成响应原文（全量日志 JSON）
 * @param {{ apiPath?: string, poolName?: string, userName?: string, productKey?: string, isElb?: boolean }} groupCtx 组上下文（isElb 影响 extractDiagnosticText 拼 errorMessage 语义）
 * @param {{ rules: import('./patrolSeeds.js').PatrolRootCauseRule[], llm?: { apiKey?: string, baseUrl?: string, model?: string, forward?: typeof import('./llmProxy.js').forwardLlmChatCompletion }, onStage?: (stage: string, msg: string) => void }} deps
 *   rules 必传（归因规则表——真源 meta.taxonomy_managed 种子/运营维护）；
 *   llm 可注入测试替身；onStage 可选进度回调（脚本端日志用）。
 * @returns {Promise<{
 *   status: 'success' | 'no_diagnosis',
 *   l1: string, l2: string, productAction: '待处理' | '—',
 *   rootCauseSource: 'llm' | 'rule' | null,
 *   conclusion: string | null, directCause: string[], evidence: string[], suggestion: string | null,
 *   llmAttempts: number, llmFailed: boolean,
 * }>}
 *   status='no_diagnosis' = LLM 3 次全败（调用方保持组 pending，不落库不推分类）；
 *   status='success' 但 rootCauseSource='rule' = LLM 未配置/未产出的降级链路（合法状态）。
 */
export async function runPatrolDiagnosisPipeline(mcpText, groupCtx = {}, deps = {}) {
  const { rules } = deps
  const onStage = typeof deps.onStage === 'function' ? deps.onStage : null
  const isElb = Boolean(groupCtx.isElb)
  const text = extractDiagnosticText(mcpText, '', isElb)

  // ---------- ① 快速路径：无失败语义 → 诊断能力缺口（不烧 LLM）
  if (!text.trim()) {
    const classified = classifyPatrolRootCause('', rules) // → { l1: 诊断能力缺口, l2: 无诊断结论, productAction: '—' }
    onStage?.('diagnose', '无失败语义（快速路径）→「诊断能力缺口」')
    return {
      status: 'success',
      l1: classified.l1,
      l2: '', // 11-18 拍板：诊断能力缺口不显示细分场景（l2 置空，前端只显 L1）
      productAction: classified.productAction,
      rootCauseSource: null, // 无 LLM 产物、无规则对语义的匹配——旧形态数据该列为 null（11-17 前）
      conclusion: null,
      directCause: [],
      evidence: [],
      suggestion: null,
      llmAttempts: 0,
      llmFailed: false,
    }
  }

  // ---------- ② LLM 结构化分析（全部组——11-18 拍板：归类输入=LLM 结论文本）
  const analysis = await analyzeFailureByLlm(mcpText, {
    apiPath: groupCtx.apiPath, poolName: groupCtx.poolName, userName: groupCtx.userName, productKey: groupCtx.productKey,
  }, {
    onRetry: (attempt, reason) => onStage?.('diagnose', `LLM 第 ${attempt} 次失败（${reason}）——重试`),
    // analyzer 契约是 deps.llm.forward（嵌套）——spread 平铺会被无视并静默回退真配置，
    // 必须嵌套传递（红绿实测教训：平铺时 mock 丢失、真网关被调）。
    llm: deps.llm,
  })

  // ---------- 失败语义：3 次全败 → 未诊断（调用方保持 pending）
  if (analysis.llmFailed) {
    onStage?.('diagnose', `LLM ${analysis.attempts} 次全失败——视为未诊断（保持 pending，明日重试）`)
    return {
      status: 'no_diagnosis',
      l1: '其他/未归类', l2: '', // 11-18 拍板：L2 是场景不是来源标注——未诊断无场景，置空
      productAction: '待处理',
      rootCauseSource: null,
      conclusion: null, directCause: [], evidence: [], suggestion: null,
      llmAttempts: analysis.attempts, llmFailed: true,
    }
  }

  // ---------- ⑤ 降级：LLM 未配置（合法状态）/未产出 → 旧链路（规则对日志原文）
  if (!analysis.byLlm) {
    const classified = classifyPatrolRootCause(text, rules)
    onStage?.('diagnose', `LLM 未产出（未配置/空产出）——降级规则链路 →「${classified.l1}」`)
    return {
      status: 'success',
      l1: classified.l1,
      l2: classified.l2,
      productAction: classified.productAction,
      rootCauseSource: 'rule',
      conclusion: text || null, // 降级链路结论=日志原文（既有语义——LLM 未配置环境的合法形态）
      directCause: [],
      evidence: [],
      suggestion: null, // 调用方走建议生成器兜底（generateDiagnosisSuggestion(text, text, l1)）
      llmAttempts: analysis.attempts,
      llmFailed: false,
    }
  }

  // ---------- ③④ LLM 已产出：规则表对 LLM 产物文本定类；未命中 → LLM 枚举兜底
  const classificationText = buildClassificationText(analysis)
  const classified = classifyPatrolRootCause(classificationText, rules)
  if (classified.l1 !== '其他/未归类' && classified.l1 !== '诊断能力缺口') {
    // 规则命中（对 LLM 语义文本）——规则表=归类真源
    onStage?.('diagnose', `规则命中（LLM 语义文本）→「${classified.l1}」`)
    return {
      status: 'success',
      l1: classified.l1,
      l2: classified.l2,
      productAction: classified.productAction,
      rootCauseSource: 'llm', // 五段是 LLM 产的（类是规则定的——标注只描述五段产出方）
      conclusion: analysis.conclusion,
      directCause: analysis.directCause,
      evidence: analysis.evidence,
      suggestion: analysis.suggestion,
      llmAttempts: analysis.attempts,
      llmFailed: false,
    }
  }
  // 规则未命中 → LLM 枚举判断（analyzeFailureByLlm 已产 rootCauseL1——同一调用产物直接用，不二次调用）
  const l1 = analysis.rootCauseL1 || '其他/未归类'
  onStage?.('diagnose', `规则未命中——LLM 枚举判断 →「${l1}」`)
  return {
    status: 'success',
    l1,
    l2: extractL2FromConclusion(analysis.conclusion), // 11-18 拍板：L2=细分场景（结论首句核心语义），不是来源标注
    productAction: '待处理',
    rootCauseSource: 'llm',
    conclusion: analysis.conclusion,
    directCause: analysis.directCause,
    evidence: analysis.evidence,
    suggestion: analysis.suggestion,
    llmAttempts: analysis.attempts,
    llmFailed: false,
  }
}

/**
 * L2 细分场景提取（11-18 拍板：L2 是场景不是来源标注）——从 LLM 结论取首句核心语义短语。
 * 规则：取第一句；剥「根因/原因/导致/因为」等引导词与句末标点；≤24 字；空结论 → '语义识别待细分'。
 * @param {string | null} conclusion LLM 诊断结论
 * @returns {string}
 */
function extractL2FromConclusion(conclusion) {
  const first = String(conclusion || '')
    .split(/[。；;.！!？?\n]/)[0] // 首句
    .trim()
  if (!first) return '语义识别待细分'
  const cleaned = first
    .replace(/^(根因|原因|直接原因|故障原因|失败原因|经分析|诊断结果)[是为：:\s]*/i, '')
    .replace(/[，,]\s*(由于|因为|系)\s*/g, '，')
    .trim()
  return cleaned.length > 24 ? `${cleaned.slice(0, 24)}…` : cleaned
}
