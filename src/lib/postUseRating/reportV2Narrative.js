import { getLlmCompletionText, llmChatCompletion, parseLlmMessageContent } from '../llmClient.js'
import { maskPhoneInText } from '../customerMask.js'
import { REPORT_V2_L1_GROUPS, REPORT_V2_L2_REGISTRY } from './reportV2Model.js'

function shortText(value, limit = 180) {
  return String(value || '').trim().slice(0, limit)
}

/**
 * Generate reviewable wording only. Scores, issue classification, priority and owners
 * remain in the rule-built model and are never taken from model output.
 * Todo wording (11-18): one entry per todoCandidate, content = 动作短语 + 事实依据。
 * The 【产品名】 prefix is added by the render layer, so LLM output must not repeat it.
 * themeGroups (11-18 语义归类): 对未命中正则的低分标签按封闭组清单归类——
 * strictLabels 只选不造，group 不在清单内的条目丢弃（该标签回退原文自成一档，不阻塞整批）。
 */
export async function generatePostUseReportV2Narrative(settings, model) {
  // 11-19：30 条上限（原 60）——真库单期未命中标签可达 123 个，30 覆盖高频头部；
  // 归类批预算有限，尾部长尾标签收益低（回退原文自成一档语义不变）
  const ungroupedThemes = (model.ungroupedThemes || []).filter(Boolean).slice(0, 30)
  const focusFacts = model.focus.map((row, index) => ({
    index, productName: row.productName, theme: row.theme, actionType: row.actionType,
    title: row.title, detail: row.detail, action: row.text,
    priority: row.priority, owner: row.owner,
    // 11-19 P2：喂足原型级洞察句素材——生命周期、月度分布、季内低点、客户原话（已打码）
    lifecycle: row.lifecycle || '',
    monthCounts: row.monthCounts || null,
    customerQuote: row.lowestScore != null && row.recordIds?.length
      ? maskPhoneInText(String(row.quotes?.find((text) => String(text).trim() !== row.theme) || row.lowestQuotes?.[0] || ''))
      : '',
  }))
  const productFacts = model.products.map((row, index) => ({
    index, name: row.name, avg: row.avg, sample: row.sample,
    previousAvg: row.previousAvg, status: row.status,
    // 11-19 档 2 半剔除：noAction 主题不进定性素材（核心结论文案），定量统计不受影响
    themes: row.themes.filter((theme) => theme.type === 'low' && !theme.noAction).slice(0, 3)
      // 11-18 口径：客户原话进 LLM 前统一手机号打码（姓名不在此文本中，脱敏已在模型层 facts 完成）
      .map((theme) => ({ theme: theme.theme, count: theme.count, lowestScore: theme.lowestScore, lifecycle: theme.lifecycle, quotes: theme.quotes.slice(0, 1).map((quote) => maskPhoneInText(quote)) })),
  }))
  const todoFacts = (model.todoCandidates || []).map((row, index) => ({
    index, productName: row.productName, sourceKind: row.sourceKind,
    customer: row.customerMaskedName, status: row.status, facts: row.facts,
  }))
  // 11-19 两档剔除·LLM 语义判定批（第三并行批）：正则枚举不全（"无实际不满"等自由句式），
  // LLM 对正则未命中的回访/溯源文本判档；封闭集 no_dissatisfaction / no_action_needed / keep
  //（strictLabels 只选不造），id 必须逐字命中候选清单；结果存 overlay.narratives.evidenceVerdicts，
  // 建模时与正则判定合并（正则优先、LLM 补充）。
  const EVIDENCE_VERDICT_SET = ['no_dissatisfaction', 'no_action_needed', 'keep']
  const pendingVerdicts = (model.evidenceVerdictPending || [])
    .filter((row) => row && row.id).slice(0, 60)
  const verdictBatch = pendingVerdicts.length
    ? llmChatCompletion(settings, {
        purpose: 'report',
        messages: [
          { role: 'system', content: '你是客户反馈证据评估器。对每条省代表回访结果或产品部溯源文本判断客户真实状态：no_dissatisfaction=客户其实没有不满（误操作/情绪分/账户异常等，回访后客户确认无实际问题）；no_action_needed=问题存在但评估为无需优化（客户误操作/极小概率场景/统一规则限制等）；keep=有真实需求或问题待处理。只根据文本判断，不编造。只输出严格 JSON：{"verdicts":[{"id":"原文id","verdict":"no_dissatisfaction|no_action_needed|keep"}]}，id 必须与输入逐字一致。不要 Markdown，不要解释。' },
          { role: 'user', content: JSON.stringify({ verdictOptions: EVIDENCE_VERDICT_SET, evidence: pendingVerdicts.map((row) => ({ id: row.id, sourceKind: row.sourceKind, text: maskPhoneInText(String(row.text || '').slice(0, 200)) })) }) },
        ],
        temperature: 0,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }).catch(() => null)
    : null
  // 11-19 拆批（治本）：归类是"选词"任务混在文案批里会拖长整批 reasoning（深钻嫌疑源），
  // 独立成小批——文案批 prompt 瘦身，归类批 4000 预算 + 短指令；归类失败回退原文自成一档。
  const messages = [
    { role: 'system', content: '你是用后即评月季报编辑。只根据输入事实改写文字，不编造数量、责任人、产品结论或处理进展。focus 的行动标签、优先级和责任人不可改。title 写一句洞察结论：优先体现数量与时点（新增 N 条/集中爆发月份），有季内低点或根因线索时点出影响（如"拖低 8 月均分至 X"）；detail 写一行补充事实：根因线索（溯源结论）+ 影响（低点/分布）+ 下一步动作，参考素材 customerQuote 为客户原话可引用。产品 conclusion 最多两句。todos 为每条待办写 content：一句动作短语开头（溯源未完结→跟进回溯闭环；回访未评估→完成回访评估；举措待推进→推进举措落地），后接事实依据，共不超过 120 字，不写【产品名】前缀，不编造客户姓名。每项保持原 index。输出严格 JSON：{"focus":[{"index":0,"title":"...","detail":"..."}],"products":[{"index":0,"conclusion":"..."}],"todos":[{"index":0,"content":"..."}]}。不要 Markdown。' },
    { role: 'user', content: JSON.stringify({ kind: model.kind, months: model.months, focus: focusFacts, products: productFacts, todos: todoFacts }) },
  ]
  // 11-18 实证：推理型模型（moma/deepseek-latest-flash）reasoning 与正文共享 max_tokens 预算，
  // 4000 预算下生产规模输入（99 产品）reasoning 吃光预算（实测 reasoning=4000、text=0），
  // 正文空/截断 → 两种「不是合法 JSON」报错。16000 为生产规模实测安全值
  //（completion 8501 = reasoning 5409 + text 3091）。
  // 11-19 实证：同输入 reasoning 深度随机波动 2 倍+（5167 vs 2558 tokens），异常深钻时
  // 两轮仍爆（用户真机报「被截断」）。梯子扩三档 16000→24000→36000 覆盖深钻尾部。
  // 11-19 并行化（504 修复）：归类批与文案批并行发起（Promise 浮签，失败自吞）——
  // 串行时总时长 = 文案批 + 归类批，轻松突破 nginx /api/ 默认 60s 网关超时（真机 504 实证）；
  // 并行后总时长 = max(文案批, 归类批)，归类批 4000 预算独立小请求无竞争。
  const groupSet = new Set(REPORT_V2_L1_GROUPS)
  const groupBatch = ungroupedThemes.length
    ? llmChatCompletion(settings, {
        purpose: 'report',
        messages: [
          // 11-19 L1/L2 体系改版：L1 八大类封闭（只选不造），判定树写进 prompt；
          // L2 细类开放（登记表参考，可空）；共享带宽能力限制仅限弹性公网IP。
          { role: 'system', content: '你是低分反馈标签分类器。对每个标签按判定树选一个 L1 大类（封闭清单，只选不造）：①能力不存在/给不了（没有、不支持、规格/地域给不了、能力限制）→功能缺失/不完善；②页面/API 操作层：正在执行操作时失败/报错/走不通/慢/卡/超时→操作执行性能/稳定性不足；③资源/服务层：服务或网络本身故障/慢/不稳（故障频发、连接不稳、业务服务慢）→服务资源性能/稳定性不足；④操作能完成但路径难（复杂/找不到入口/不会用/指引缺失）→操作与帮助体验；⑤规格参数选择、购买路径→购买与配置决策；⑥价格/费用/计费→价格与商务；⑦安全/权限/合规→安全与合规；⑧服务态度/响应速度/处理进度→服务与响应。语义都不贴切时 l1 返回 ""。可选填 l2 细类（如 MOP 退订链路、IP 地域匹配；共享带宽能力限制仅限弹性公网IP 产品；没有贴切细类填 ""）。只输出严格 JSON：{"themeGroups":[{"theme":"原文","l1":"大类名","l2":"细类名或空"}]}，theme 必须与输入原文逐字一致。不要 Markdown，不要解释。' },
          { role: 'user', content: JSON.stringify({ candidateL1: REPORT_V2_L1_GROUPS, candidateL2: REPORT_V2_L2_REGISTRY.map((row) => row.name), ungroupedThemes }) },
        ],
        temperature: 0,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }).catch(() => null)
    : null
  const TOKEN_LADDER = [16000, 24000, 36000]
  let response = null
  for (const maxTokens of TOKEN_LADDER) {
    response = await llmChatCompletion(settings, {
      purpose: 'report',
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    })
    const choice = response?.data?.choices?.[0] || response?.choices?.[0]
    if (!['length', 'max_tokens'].includes(choice?.finish_reason)) break
  }
  const result = /** @type {any} */ (() => {
    try {
      return parseLlmMessageContent(getLlmCompletionText(response))
    } catch (err) {
      // 11-19：梯子三档全跑完仍截断——转可自愈提示（推理深度随机，重试一次大概率成功）
      if (err instanceof Error && err.message.includes('被截断')) {
        throw new Error(`模型推理超出 ${TOKEN_LADDER.join('/')} 预算仍未完成（推理型模型思考深度有随机波动），请重试一次；持续失败请联系管理员检查模型配置或减少产品范围`)
      }
      throw err
    }
  })()
  if (!result || !Array.isArray(result.focus) || !Array.isArray(result.products)) {
    throw new Error('报告模型未返回完整文案，请重试')
  }
  const focus = {}
  for (const item of result.focus) {
    const source = model.focus[Number(item?.index)]
    if (!source) continue
    const title = shortText(item.title, 150)
    const detail = shortText(item.detail, 280)
    if (title && detail && !/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}/i.test(`${title} ${detail}`)) {
      focus[source.id] = { title, detail }
    }
  }
  const products = {}
  for (const item of result.products) {
    const source = model.products[Number(item?.index)]
    if (!source) continue
    const conclusion = shortText(item.conclusion, 260)
    if (conclusion && !/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}/i.test(conclusion)) {
      products[`product:${source.name}`] = conclusion
    }
  }
  const todos = {}
  if (Array.isArray(result.todos)) {
    for (const item of result.todos) {
      const source = (model.todoCandidates || [])[Number(item?.index)]
      if (!source) continue
      const content = shortText(item.content, 160)
      // 防 LLM 双写产品前缀 / 编造：content 与候选产品名对不上前缀形态也放行（渲染层统一拼前缀），
      // 但 UUID 与空值丢弃——丢弃后由页面回退规则模板文案，不阻塞整批。
      if (content && !/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}/i.test(content)) {
        todos[source.id] = content
      }
    }
  }
  // todos 单独成批也合法（11-18）：focus/products 生成失败不连带丢待办文案
  // themeGroups 同理：归类失败只丢覆盖表，不阻塞文案批（标签回退原文自成一档）
  // 11-19：归类批与文案批并行发起（上方 groupBatch 浮签），此处 await 收结果
  // L1/L2 体系：themeGroupLabels 存 L1 名（classifyReportTheme 经 legacy 映射读取）；
  // l2 细类存独立覆盖表 themeL2Labels（展示"分布"灰字用，不进聚合键）。
  const themeGroupLabels = {}
  const themeL2Labels = {}
  const groupResponse = groupBatch ? await groupBatch : null
  if (groupResponse) {
    try {
      const groupResult = /** @type {any} */ (parseLlmMessageContent(getLlmCompletionText(groupResponse)))
      if (Array.isArray(groupResult?.themeGroups)) {
        for (const item of groupResult.themeGroups) {
          const theme = String(item?.theme || '').trim()
          const l1 = String(item?.l1 || item?.group || '').trim()
          const l2 = String(item?.l2 || '').trim()
          // strictLabels 只选不造：L1 必须在 8 类封闭清单内；theme 必须逐字命中未归类标签原文
          if (!theme || !l1 || !groupSet.has(l1) || !ungroupedThemes.includes(theme)) continue
          themeGroupLabels[theme] = l1
          if (l2) themeL2Labels[theme] = l2
        }
      }
    } catch {
      // 归类批失败（截断/网络/解析）不阻塞文案批——标签回退原文自成一档
    }
  }
  // 11-19：verdicts 批与文案批/归类批并行发起（上方 verdictBatch 浮签），此处 await 收结果；
  // 失败/非法条目丢弃（正则判定兜底，枚举外句式按 keep 处理——不误剔除）
  const evidenceVerdicts = {}
  const verdictResponse = verdictBatch ? await verdictBatch : null
  if (verdictResponse) {
    try {
      const verdictResult = /** @type {any} */ (parseLlmMessageContent(getLlmCompletionText(verdictResponse)))
      const verdictSet = new Set(EVIDENCE_VERDICT_SET)
      const pendingIds = new Set(pendingVerdicts.map((row) => String(row.id)))
      if (Array.isArray(verdictResult?.verdicts)) {
        for (const item of verdictResult.verdicts) {
          const id = String(item?.id || '').trim()
          const verdict = String(item?.verdict || '').trim()
          // strictLabels 只选不造 + id 逐字命中候选清单；keep 判定不存储（默认语义即 keep）
          if (!id || !verdict || !verdictSet.has(verdict) || !pendingIds.has(id) || verdict === 'keep') continue
          evidenceVerdicts[id] = verdict
        }
      }
    } catch {
      // verdicts 批失败不阻塞文案批——回退纯正则判定
    }
  }
  if (!Object.keys(focus).length && !Object.keys(products).length && !Object.keys(todos).length
    && !Object.keys(themeGroupLabels).length) {
    throw new Error('报告模型返回的文案不可用，请重试')
  }
  return { focus, products, todos, themeGroupLabels, themeL2Labels, evidenceVerdicts }
}
