import {
  getLlmCompletionText,
  isLlmAvailable,
  llmChatCompletion,
  parseLlmMessageContent,
} from '../llmClient.js'
import { getCatalogProducts } from '../productCatalogLoader.js'
import { TOPIC_TYPE_LABELS } from './constants.js'
import { normalizeIdentityText } from './customerIdentity.js'
import { parseTopicSearchQuery, topicProductHints } from './matchQuery.js'

function catalogDisplayName(token) {
  const needle = normalizeIdentityText(token)
  if (!needle) return ''
  for (const product of getCatalogProducts() || []) {
    const candidates = [product.name, product.key, ...(product.specs || []).flatMap((spec) => [spec.name, ...(spec.match || [])])]
    if (candidates.some((item) => {
      const normalized = normalizeIdentityText(item)
      return normalized === needle || normalized.includes(needle) || needle.includes(normalized)
    })) {
      return product.name
    }
  }
  return ''
}

function uniqueTexts(values) {
  const seen = new Set()
  const out = []
  for (const value of values || []) {
    const text = String(value || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function allowedProductName(name, query) {
  const display = catalogDisplayName(name)
  if (display) return display
  const raw = String(name || '').trim()
  if (!raw) return ''
  const blob = normalizeIdentityText(query)
  return blob.includes(normalizeIdentityText(raw)) ? raw : ''
}

function allowedCustomerValue(value, query) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const blob = normalizeIdentityText(query)
  const needle = normalizeIdentityText(raw)
  if (!blob || !needle) return ''
  return blob.includes(needle) ? raw : ''
}

function extractCustomerFromQuery(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return { customerName: '', customerCode: '' }
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{3,}$/.test(trimmed)) {
    return { customerName: '', customerCode: trimmed }
  }
  const named = trimmed.match(/[\u4e00-\u9fffA-Za-z0-9]+(?:公司|集团|局|厅|委|大学|学院|医院|银行|有限公司|股份)/)
  if (named) return { customerName: named[0], customerCode: '' }
  return { customerName: trimmed, customerCode: '' }
}

/**
 * 规则理解：拆产品名与问题片段，或抽出客户名称/编码，供用户确认。
 * @param {string} query
 * @param {string} type
 */
export function buildRuleInterpretation(query, type) {
  const text = String(query || '').trim()
  const typeLabel = TOPIC_TYPE_LABELS[type] || type

  if (type === 'customer') {
    const identity = extractCustomerFromQuery(text)
    const label = identity.customerName || identity.customerCode || text
    const looksLikeProblem = !identity.customerCode && !/(公司|集团|局|厅|委|大学|学院|医院|银行|有限|股份)/.test(text)
      && !/^[A-Za-z0-9][A-Za-z0-9._-]{3,}$/.test(text)
    const questions = []
    if (looksLikeProblem) {
      questions.push('没有识别到客户名称或编码。客户专题只按客户匹配，若要看某个问题请改成产品问题或共性问题专题。')
    } else if (identity.customerName && identity.customerName !== text) {
      questions.push(`已从这段话中抽出客户「${identity.customerName}」。若不是这家客户，请改名称或编码。`)
    }
    return {
      source: 'rule',
      title: `客户 · ${label}`,
      type,
      products: [],
      problem: '',
      keywords: [],
      customerName: identity.customerName,
      customerCode: identity.customerCode,
      interpretation: `按${typeLabel}理解：分析对象是客户「${label}」。将按客户名称或集团客户编码匹配，不按问题关键词检索。`,
      scopeNote: `分析范围：该客户在所选周期内的投诉、咨询、用后即评。`,
      questions,
    }
  }

  const parsed = parseTopicSearchQuery(text)
  const products = uniqueTexts(parsed.productTokens.map(catalogDisplayName).filter(Boolean))
  const keywords = uniqueTexts(
    parsed.tokens.filter((token) => !parsed.productTokens.includes(token)),
  )
  const problem = keywords.join('') || text
  const title = products[0] && problem && problem !== products[0]
    ? `${products[0]} · ${problem}`
    : (products[0] || problem || text)
  const productBit = products.length
    ? `对象是「${products.join('、')}」`
    : '没有识别到明确产品，将按问题词匹配'
  const questions = []
  if (type === 'product_issue' && !products.length) {
    questions.push('没有识别到产品名。是只看某一个产品，还是改成共性问题专题？')
  }
  if (type === 'common_issue' && products.length === 1) {
    questions.push(`输入里出现了「${products[0]}」。共性问题会跨产品匹配；若只看该产品，请改成产品问题专题。`)
  }
  return {
    source: 'rule',
    title,
    type,
    products,
    problem,
    keywords,
    interpretation: `按${typeLabel}理解：${productBit}；问题关注「${problem}」。匹配时允许中间夹字，限速等词可用近义。`,
    scopeNote: type === 'product_issue' && products[0]
      ? `分析范围：${products[0]} 上与「${problem}」相关的投诉、咨询、用后即评。`
      : `分析范围：与「${problem}」相关的投诉、咨询、用后即评${products.length ? `（输入中的产品：${products.join('、')}）` : '（不限产品）'}。`,
    questions,
  }
}

/**
 * 用模型结果覆盖文案；产品名必须来自目录或用户原文，不能新造。
 * @param {object} baseline
 * @param {object} [parsed]
 * @param {string} query
 */
export function applyLlmInterpretation(baseline, parsed, query) {
  if (!parsed || typeof parsed !== 'object') return baseline
  const products = uniqueTexts((Array.isArray(parsed.products) ? parsed.products : [])
    .map((name) => allowedProductName(name, query))
    .filter(Boolean))
  const keywords = uniqueTexts(Array.isArray(parsed.keywords) ? parsed.keywords : baseline.keywords)
  const problem = String(parsed.problem || '').trim() || baseline.problem
  const title = String(parsed.title || '').trim() || baseline.title
  const interpretation = String(parsed.interpretation || '').trim() || baseline.interpretation
  const scopeNote = String(parsed.scopeNote || '').trim() || baseline.scopeNote
  const questions = uniqueTexts(Array.isArray(parsed.questions) ? parsed.questions : baseline.questions).slice(0, 3)
  const customerName = allowedCustomerValue(parsed.customerName, query) || baseline.customerName || ''
  const customerCode = allowedCustomerValue(parsed.customerCode, query) || baseline.customerCode || ''
  return {
    ...baseline,
    source: 'llm',
    title,
    products: products.length ? products : baseline.products,
    problem,
    keywords: keywords.length ? keywords : baseline.keywords,
    customerName,
    customerCode,
    interpretation,
    scopeNote,
    questions,
  }
}

/**
 * @param {{ query: string, type: string, settings?: object }} input
 */
export async function interpretCustomTopic(input) {
  const query = String(input?.query || '').trim()
  const type = input?.type || 'common_issue'
  const baseline = buildRuleInterpretation(query, type)
  if (!query) return baseline
  if (!isLlmAvailable(input.settings)) return baseline
  try {
    const data = await llmChatCompletion(input.settings, {
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content:
            '你是云产品体验分析师。根据用户一段话，归纳专题要分析的对象和范围。输出 JSON：{"title":"...","products":[],"problem":"...","keywords":[],"customerName":"...","customerCode":"...","interpretation":"...","scopeNote":"...","questions":[]}。products 只能来自给定产品目录或用户原文。customerName/customerCode 只能来自用户原文。interpretation/scopeNote 各 1-2 句，用中文对用户说话。questions 最多 2 个待确认点。禁止编造工单、客户或数字。客户专题重点抽出客户，不要把问题词当成客户名。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            type,
            typeLabel: TOPIC_TYPE_LABELS[type],
            query,
            catalogProducts: topicProductHints().slice(0, 40),
          }),
        },
      ],
    })
    const parsed = parseLlmMessageContent(getLlmCompletionText(data))
    return applyLlmInterpretation(baseline, parsed, query)
  } catch {
    return baseline
  }
}

/**
 * 把确认后的理解写回专题对象，供取证匹配使用。
 * @param {object} topic
 * @param {object} interpretation
 */
export function applyInterpretationToTopic(topic, interpretation) {
  if (!topic || !interpretation) return topic
  const products = uniqueTexts(interpretation.products)
  const keywords = uniqueTexts(interpretation.keywords)
  const problem = String(interpretation.problem || '').trim()
  const customerName = String(interpretation.customerName || '').trim()
  const customerCode = String(interpretation.customerCode || '').trim()
  const matchQuery = uniqueTexts([...products, problem, ...keywords]).join(' ')
  const isCustomer = topic.type === 'customer' || interpretation.type === 'customer'
  return {
    ...topic,
    title: String(interpretation.title || topic.title).trim() || topic.title,
    product: isCustomer ? topic.product : (products[0] || topic.product),
    problemKey: isCustomer ? topic.problemKey : (problem || keywords.join('') || topic.problemKey),
    customerName: isCustomer ? customerName : topic.customerName,
    customerCode: isCustomer ? customerCode : topic.customerCode,
    query: isCustomer ? (customerName || customerCode || topic.query) : topic.query,
    matchQuery: isCustomer ? (customerName || customerCode || topic.query) : (matchQuery || topic.query),
    whyNow: interpretation.interpretation || topic.whyNow,
    interpretation,
  }
}
