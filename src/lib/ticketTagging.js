import { getTaxonomy, resolveProductKey } from './productTaxonomy.js'
import { getNodeMapsForProduct, hasRequestNodeMaps } from './taxonomyLoader.js'
import { extractCustomerQuote, extractResponseText } from './extract.js'
import { isValidRootCause } from './journeyOptimizationLLM.js'
import { matchSharedLabel, resolveProblemTypeFromConfig } from './dimensionTagging.js'

const ROOT_CAUSE_KW = [
  '根因', '原因', '由于', '导致', '是因为', '经排查', '定位为', '问题在于',
]

const UNKNOWN_L1 = '未识别环节'
const UNKNOWN_L2 = '未识别子环节'

export { UNKNOWN_L1 as JOURNEY_UNKNOWN_L1, UNKNOWN_L2 as JOURNEY_UNKNOWN_L2 }

/**
 * @typedef {{ journeyL1: string; journeyL2: string; score: number }} JourneyTextMatch
 */

/**
 * 仅从工单正文匹配旅程，并返回本地置信分数（关键词 +3）
 * @param {string} text
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {string} [taxonomyKey]
 * @returns {JourneyTextMatch}
 */
export function matchJourneyFromTextWithScore(text, journeys, taxonomyKey) {
  const lower = text.toLowerCase()
  const title = (text.match(/工单标题[：:]([^\n]+)/) || [])[1] || ''
  const titleLower = title.toLowerCase()
  const corpus = titleLower + lower

  let bestL1 = UNKNOWN_L1
  let bestL2 = UNKNOWN_L2
  let bestScore = 0

  for (const l1 of journeys) {
    for (const l2 of l1.children) {
      let score = 0
      const desc = (l2.description || '').toLowerCase()
      const descTokens = desc.match(/[\u4e00-\u9fa5]{2,}/g) || []
      for (const kw of l2.keywords || []) {
        if (lower.includes(kw.toLowerCase())) score += 3
      }
      for (const t of descTokens) {
        if (lower.includes(t)) score += 1
      }
      if (l1.description && lower.includes(l1.description.slice(0, 6))) score += 1
      if (score > bestScore) {
        bestScore = score
        bestL1 = l1.label
        bestL2 = l2.label
      }
    }
  }

  if (taxonomyKey === 'eip' && bestScore === 0) {
    const eipHint = inferEipJourneyFromKeywords(corpus, journeys)
    if (eipHint) {
      return { journeyL1: eipHint.journeyL1, journeyL2: eipHint.journeyL2, score: 3 }
    }
  }

  if (bestScore > 0) {
    return { journeyL1: bestL1, journeyL2: bestL2, score: bestScore }
  }

  return { journeyL1: UNKNOWN_L1, journeyL2: UNKNOWN_L2, score: 0 }
}

/**
 * 仅从工单正文（标题、处理意见、客户问题等）匹配旅程
 * @param {string} text
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {string} [taxonomyKey]
 */
function matchJourneyFromText(text, journeys, taxonomyKey) {
  const { journeyL1, journeyL2 } = matchJourneyFromTextWithScore(text, journeys, taxonomyKey)
  return { journeyL1, journeyL2 }
}

/**
 * EIP 正文关键词兜底（不读取请求节点字段）
 * @param {string} corpus
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 */
function inferEipJourneyFromKeywords(corpus, journeys) {
  /** @type {string | null} */
  let l1Id = null
  if (/退订|释放|删除|到期/.test(corpus)) l1Id = 'release'
  else if (/绑定|解绑|网卡|空闲.*ip/i.test(corpus)) l1Id = 'bind'
  else if (/带宽|升降配/.test(corpus)) l1Id = 'bind'
  else if (/无法访问|不通|外网|ip无法访问/i.test(corpus)) l1Id = 'operate'
  else if (/丢包|波动|ping|延迟/.test(corpus)) l1Id = 'operate'
  else if (/远程|登录|ssh|rdp/.test(corpus)) l1Id = 'operate'
  else if (/流量|监控|查询.*流量/.test(corpus)) l1Id = 'operate'
  else if (/开通|创建|配额/.test(corpus)) l1Id = 'provision'
  else if (/协查|排查|根因|无法复现/.test(corpus)) l1Id = 'incident'
  if (!l1Id) return null

  const l1Node = journeys.find((j) => j.id === l1Id)
  if (!l1Node?.children?.length) return null

  let best = 0
  let l2Node = null
  for (const child of l1Node.children) {
    let score = 0
    for (const kw of child.keywords || []) {
      if (corpus.includes(kw.toLowerCase())) score += 3
    }
    if (score > best) {
      best = score
      l2Node = child
    }
  }

  return {
    journeyL1: l1Node.label,
    journeyL2: l2Node?.label || UNKNOWN_L2,
  }
}

/**
 * 解析工单「请求节点」→ 旅程（仅按 Excel 映射表，不做猜测）
 * @param {string} text
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {string} taxonomyKey
 */
function parseRequestNodeJourney(text, journeys, taxonomyKey) {
  const m = text.match(/请求节点[：:]([^\n]+)/)
  if (!m) return null

  const { serviceMap, issueMap } = getNodeMapsForProduct(taxonomyKey)
  if (!Object.keys(serviceMap).length && !Object.keys(issueMap).length) return null

  const parts = m[1]
    .split('--')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'undefined')

  if (parts.length < 2) return null

  const serviceType = parts.length >= 3 ? parts[2] : parts[parts.length - 2] || ''
  const issueType = parts[parts.length - 1] || ''

  let l1Id = serviceMap[serviceType] || null
  const issueHint = issueMap[issueType]
  if (issueHint) l1Id = issueHint.l1
  if (!l1Id) return null

  const l1Node = journeys.find((j) => j.id === l1Id)
  if (!l1Node) return null

  let l2Node = null
  if (issueHint?.l2) {
    l2Node = l1Node.children.find((c) => c.id === issueHint.l2)
  }
  if (!l2Node) return { journeyL1: l1Node.label, journeyL2: UNKNOWN_L2 }

  return { journeyL1: l1Node.label, journeyL2: l2Node.label }
}

/**
 * @param {{ journeyL1: string; journeyL2: string }} textResult
 * @param {{ journeyL1: string; journeyL2: string } | null} nodeResult
 */
function applyRequestNodeFallback(textResult, nodeResult) {
  if (!nodeResult) return textResult
  if (textResult.journeyL1 !== UNKNOWN_L1) return textResult
  return nodeResult
}

/**
 * 关键词 + 描述 综合匹配旅程（本地，无 LLM）
 * @param {string} text
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {string} [taxonomyKey]
 * @param {{ useRequestNode?: boolean }} [opts]
 */
export function matchJourneyByDescription(text, journeys, taxonomyKey, opts = {}) {
  const textResult = matchJourneyFromText(text, journeys, taxonomyKey)

  const useRequestNode =
    opts.useRequestNode === true &&
    taxonomyKey &&
    hasRequestNodeMaps(taxonomyKey)

  if (!useRequestNode) return textResult

  const nodeResult = parseRequestNodeJourney(text, journeys, taxonomyKey)
  return applyRequestNodeFallback(textResult, nodeResult)
}

export function extractProblemSummary(text) {
  const quote = extractCustomerQuote(text)
  if (quote && quote.length > 10) return quote.slice(0, 300)
  const title = text.match(/工单标题[：:]([^\n]+)/)
  if (title) return title[1].trim().slice(0, 300)
  const demand = text.match(/客户需求[：:]([^\n|]+)/)
  if (demand) return demand[1].trim().slice(0, 300)
  const detail = text.match(/详细内容[：:]([^\n|]+)/)
  if (detail) return detail[1].trim().slice(0, 300)
  return text.slice(0, 200).replace(/\s+/g, ' ')
}

export function extractSolutionSummary(text, fromCol) {
  if (fromCol?.trim()) return fromCol.trim().slice(0, 400)
  const sol = extractResponseText(text)
  if (sol) return sol.slice(0, 400)
  const ops = [...text.matchAll(/处理意见[：:]([^\n|]+)/g)]
  if (ops.length) return ops[ops.length - 1][1].trim().slice(0, 400)
  return ''
}

export function extractRootCause(text, fromCol) {
  if (fromCol?.trim()) return fromCol.trim().slice(0, 300)
  const rc = text.match(/根因[（(]?必填[）)]?[：:]([^\n]+)/)
  if (rc) return rc[1].trim().slice(0, 300)
  const mobile = text.match(/移动云投诉根因[：:]([^\n]+)/)
  if (mobile) return mobile[1].trim().slice(0, 300)
  for (const kw of ROOT_CAUSE_KW) {
    const idx = text.indexOf(kw)
    if (idx >= 0) return text.slice(idx, idx + 120).trim()
  }
  return ''
}

function extractOptimization(text, solution, rootCause, journeyL2) {
  const suggestions = []

  if (/无法复现|根因未明/.test(rootCause + text)) {
    suggestions.push('在「故障与应急-协查定位」环节加强链路追踪、资源池级监控与复现手册。')
  }

  const journeyTips = {
    '绑定/解绑云资源': '优化控制台绑定流程与 IPv4/IPv6 双栈提示，降低绑定失败率。',
    '公网访问不通': '完善安全组/白名单自助排查工具，提供常见「不通」场景 playbook。',
    '网络质量与丢包': '建立资源池网络质量看板，对金牌客户主动预警波动。',
    '退订/释放资源': '修复到期退订链路，避免「无法退订」需人工清理。',
    '带宽升降配': '带宽变更订单与计费联动透明化，失败时给出可操作建议。',
  }
  if (journeyL2 && journeyTips[journeyL2]) {
    suggestions.push(journeyTips[journeyL2])
  }

  if (suggestions.length === 0 && isValidRootCause(rootCause)) {
    suggestions.push(
      `针对「${journeyL2 || '该环节'}」高频根因类型，立项平台修复并建立验收标准与自助诊断能力。`,
    )
  }

  return suggestions.filter(Boolean).join(' ') || ''
}

/**
 * @param {Object} input
 * @param {{ useRequestNodeForJourney?: boolean }} [opts]
 */
export function tagTicket(input, opts = {}) {
  const text = input.rawText?.trim() || ''
  const product = input.product?.trim() || ''
  const taxonomyKey = input.productKey?.trim() || resolveProductKey(product)
  const taxonomy = getTaxonomy(product, taxonomyKey)

  const requestScene = matchSharedLabel(text, taxonomy.requestScenes)
  const problemType = resolveProblemTypeFromConfig(text, taxonomy.problemTypes)

  const { journeyL1, journeyL2 } = matchJourneyByDescription(
    text,
    taxonomy.journeys,
    taxonomy.key,
    { useRequestNode: opts.useRequestNodeForJourney === true },
  )
  const problemSummary = extractProblemSummary(text)
  const solutionSummary = extractSolutionSummary(text, input.solutionCol)
  const rootCause = extractRootCause(text, input.rootCauseCol)
  const optimizationSuggestion = extractOptimization(
    text,
    solutionSummary,
    rootCause,
    journeyL2,
  )

  return {
    productKey: taxonomy.key || taxonomyKey,
    requestScene,
    problemType,
    journeyL1,
    journeyL2,
    problemSummary,
    solutionSummary,
    rootCause: rootCause || '待分析',
    optimizationSuggestion,
    resourcePool: input.resourcePool?.trim() || undefined,
  }
}
