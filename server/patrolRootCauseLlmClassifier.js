/**
 * API 巡检根因 LLM 语义兜底分类器（11-17 拍板）。
 * 规则表未命中的文本 → LLM 从 7 类枚举中选（strictLabels 只选不造）；
 * LLM 判不出/超时/未配置 → 保持「其他/未归类」（宁缺毋滥）。
 * 类目边界（互斥三规则，docs/DESIGN-API巡检.md §6.2）：
 *   时间维度：稍后重试可成功=资源锁定/并发冲突；必须改变资源状态=资源状态异常。
 *   对象维度：单资源实例状态=资源状态异常；产品级策略限制一类操作=业务冲突。
 *   侧向维度：请求构造侧问题=参数无效/校验失败；服务端处理中拒绝=其余类。
 */
import { resolveLlmApiKey, resolveLlmBaseUrl, resolveLlmModel } from './llmConfig.js'
import { forwardLlmChatCompletion } from './llmProxy.js'
import { getLlmCompletionText } from '../src/lib/llmClient.js'

/** LLM 可选的 L1 枚举（与规则表 L1 值域一致——只选不造）。 */
export const LLM_ROOT_CAUSE_L1_OPTIONS = [
  '业务冲突',
  '配额不足',
  '资源锁定/并发冲突',
  '参数无效/校验失败',
  '资源状态异常',
  '诊断能力缺口',
  '其他/未归类',
]

const SYSTEM_PROMPT = `你是云平台 API 失败根因分类助手。从给定枚举中为失败日志文本选一个根因大类，只输出枚举值本身，不输出任何其他内容。
枚举值：业务冲突 | 配额不足 | 资源锁定/并发冲突 | 参数无效/校验失败 | 资源状态异常 | 诊断能力缺口 | 其他/未归类

类目边界（判定顺序即优先级）：
1. 诊断能力缺口——文本只有正常调用日志/框架日志（如"调用方法""记录request信息"），看不出任何失败原因。
2. 参数无效/校验失败——请求侧问题：传参缺失/格式/取值不过校验（必填、为空、PARAM_INVALID）。
3. 配额不足——数量/额度上限（超限、quota）。
4. 资源锁定/并发冲突——瞬时占用：资源正被其他操作使用，稍后重试可能成功（正在执行、请稍后、并发）。
5. 资源状态异常——单资源实例状态不满足，不改状态必失败（已绑定、不存在、不允许、状态非ACTIVE）。
6. 业务冲突——产品级业务规则对一类操作的限制（不支持续订、必须先解绑、共享带宽限制）。
7. 其他/未归类——确实无法判断。

边界口诀：稍后重试能成功=4；必须改资源状态=5；策略限制一类操作=6；请求构造问题=2；看不到失败语义=1。
判不出时选"其他/未归类"，禁止编造。`

/**
 * LLM 语义兜底分类。
 * @param {string} text 分类输入（extractDiagnosticText 产出）
 * @param {{ llm?: { apiKey?: string, baseUrl?: string, model?: string, forward?: typeof forwardLlmChatCompletion } }} [deps] 测试注入
 * @returns {Promise<{ l1: string, byLlm: boolean }>} byLlm=false 表示 LLM 未决（保持兜底）
 */
export async function classifyRootCauseByLlm(text, deps = {}) {
  const t = String(text || '').trim()
  if (!t) return { l1: '其他/未归类', byLlm: false }
  /** @type {string} */
  let apiKey
  try {
    apiKey = deps.llm?.apiKey || resolveLlmApiKey()
  } catch {
    return { l1: '其他/未归类', byLlm: false }
  }
  const forward = deps.llm?.forward || forwardLlmChatCompletion
  try {
    const body = {
      model: deps.llm?.model || resolveLlmModel(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `失败日志文本（接口调用失败后的日志摘录）：\n${t}` },
      ],
      temperature: 0,
    }
    const res = await forward({
      baseUrl: deps.llm?.baseUrl || resolveLlmBaseUrl(),
      apiKey,
      body,
      timeoutMs: 15_000,
    })
    const answer = String(getLlmCompletionText(res?.data || res) || '').trim()
    // 严格枚举匹配：从选项里找完全一致的（LLM 可能带前后缀噪声，做包含匹配取最长命中）
    let best = ''
    for (const opt of LLM_ROOT_CAUSE_L1_OPTIONS) {
      if (answer.includes(opt) && opt.length > best.length) best = opt
    }
    if (!best) return { l1: '其他/未归类', byLlm: false }
    return { l1: best, byLlm: best !== '其他/未归类' }
  } catch {
    return { l1: '其他/未归类', byLlm: false }
  }
}
