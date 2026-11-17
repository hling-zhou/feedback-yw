import { getLlmCompletionText, llmChatCompletion, parseLlmMessageContent } from '../llmClient.js'

function shortText(value, limit = 180) {
  return String(value || '').trim().slice(0, limit)
}

/**
 * Generate reviewable wording only. Scores, issue classification, priority and owners
 * remain in the rule-built model and are never taken from model output.
 */
export async function generatePostUseReportV2Narrative(settings, model) {
  const focusFacts = model.focus.map((row, index) => ({
    index, productName: row.productName, theme: row.theme, actionType: row.actionType,
    title: row.title, detail: row.detail, action: row.text,
    priority: row.priority, owner: row.owner,
  }))
  const productFacts = model.products.map((row, index) => ({
    index, name: row.name, avg: row.avg, sample: row.sample,
    previousAvg: row.previousAvg, status: row.status,
    themes: row.themes.filter((theme) => theme.type === 'low').slice(0, 3)
      .map((theme) => ({ theme: theme.theme, count: theme.count, lowestScore: theme.lowestScore, lifecycle: theme.lifecycle, quotes: theme.quotes.slice(0, 1) })),
  }))
  const response = await llmChatCompletion(settings, {
    purpose: 'report',
    messages: [
      { role: 'system', content: '你是用后即评月季报编辑。只根据输入事实改写文字，不编造数量、责任人、产品结论或处理进展。focus 的行动标签、优先级和责任人不可改。title 写一句结论，detail 写一行补充事实；产品 conclusion 最多两句。每项保持原 index。输出严格 JSON：{"focus":[{"index":0,"title":"...","detail":"..."}],"products":[{"index":0,"conclusion":"..."}]}。不要 Markdown。' },
      { role: 'user', content: JSON.stringify({ kind: model.kind, months: model.months, focus: focusFacts, products: productFacts }) },
    ],
    temperature: 0.2,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  })
  const result = /** @type {any} */ (parseLlmMessageContent(getLlmCompletionText(response)))
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
  if (!Object.keys(focus).length && !Object.keys(products).length) throw new Error('报告模型返回的文案不可用，请重试')
  return { focus, products }
}
