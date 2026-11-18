import { getLlmCompletionText, llmChatCompletion, parseLlmMessageContent } from '../llmClient.js'
import { maskPhoneInText } from '../customerMask.js'
import { REPORT_V2_THEME_GROUPS } from './reportV2Model.js'

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
    themes: row.themes.filter((theme) => theme.type === 'low').slice(0, 3)
      // 11-18 口径：客户原话进 LLM 前统一手机号打码（姓名不在此文本中，脱敏已在模型层 facts 完成）
      .map((theme) => ({ theme: theme.theme, count: theme.count, lowestScore: theme.lowestScore, lifecycle: theme.lifecycle, quotes: theme.quotes.slice(0, 1).map((quote) => maskPhoneInText(quote)) })),
  }))
  const todoFacts = (model.todoCandidates || []).map((row, index) => ({
    index, productName: row.productName, sourceKind: row.sourceKind,
    customer: row.customerMaskedName, status: row.status, facts: row.facts,
  }))
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
  // 11-19：归类独立小批（4000 预算 + 短指令），文案批不再携带归类任务
  const themeGroupLabels = {}
  const groupSet = new Set(REPORT_V2_THEME_GROUPS)
  if (ungroupedThemes.length) {
    try {
      const groupResponse = await llmChatCompletion(settings, {
        purpose: 'report',
        messages: [
          { role: 'system', content: '你是低分反馈标签归类器。对每个标签从候选组清单选一个最贴切的组，不能自造组名；语义对不上的条目 group 返回 ""。只输出严格 JSON：{"themeGroups":[{"theme":"原文","group":"组名"}]}，theme 必须与输入原文逐字一致。不要 Markdown，不要解释。' },
          { role: 'user', content: JSON.stringify({ candidateGroups: REPORT_V2_THEME_GROUPS, ungroupedThemes }) },
        ],
        temperature: 0,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      })
      const groupResult = /** @type {any} */ (parseLlmMessageContent(getLlmCompletionText(groupResponse)))
      if (Array.isArray(groupResult?.themeGroups)) {
        for (const item of groupResult.themeGroups) {
          const theme = String(item?.theme || '').trim()
          const group = String(item?.group || '').trim()
          // strictLabels 只选不造：group 必须在封闭清单内；theme 必须逐字命中未归类标签原文
          if (!theme || !group || !groupSet.has(group) || !ungroupedThemes.includes(theme)) continue
          themeGroupLabels[theme] = group
        }
      }
    } catch {
      // 归类批失败（截断/网络/解析）不阻塞文案批——标签回退原文自成一档
    }
  }
  if (!Object.keys(focus).length && !Object.keys(products).length && !Object.keys(todos).length
    && !Object.keys(themeGroupLabels).length) {
    throw new Error('报告模型返回的文案不可用，请重试')
  }
  return { focus, products, todos, themeGroupLabels }
}
