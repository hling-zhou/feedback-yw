import { getTaxonomy, resolveProductKey } from './productTaxonomy.js'
import { getNodeMapsForProduct, hasRequestNodeMaps } from './taxonomyLoader.js'
import { extractCustomerQuote, extractResponseText } from './extract.js'
import { isValidRootCause } from './journeyOptimizationLLM.js'
import { matchSharedLabel, resolveProblemTypeFromConfig } from './dimensionTagging.js'
import { isMeaninglessTicketPlaceholderText } from './taggingText.js'
import { trimInlinePlatformFieldSuffix } from './ticketDetailDisplay.js'

const ROOT_CAUSE_KW = [
  '根因', '原因', '由于', '导致', '是因为', '经排查', '定位为', '问题在于',
]

const UNKNOWN_L1 = '未识别环节'
const UNKNOWN_L2 = '未识别子环节'

export { UNKNOWN_L1 as JOURNEY_UNKNOWN_L1, UNKNOWN_L2 as JOURNEY_UNKNOWN_L2 }

/**
 * @typedef {{ journeyL1: string; journeyL2: string; score: number }} JourneyTextMatch
 */

const LIMIT_UNLOCK_PROBLEM_TYPE = '配额与权限申请'

/** 数量/上限类放开限制 */
const QUANTITY_UNLOCK_RE = /配额|上限|IP数量|规格申请/

/** 灰度/订购权限类放开限制（不含裸「权限」，避免安全组等误伤） */
const PERMISSION_UNLOCK_RE =
  /灰度|订购权限|开通权限|上架|轻载|8:1|8：1|大带宽权限|解售罄|解除[^。，；\n]{0,8}售罄|控制台.{0,16}(?:看不[见着到]|找不到|不显示).{0,12}(?:IP|弹性公网|公网地址)|(?:看不见|找不到|不显示)(?:该|这个)?IP/

/** 账单/出账：提到配额但不是在申请放开 */
const BILLING_CHARGE_RE = /收取带宽配额|收取.{0,8}配额|出账|扣费|账单/
const QUOTA_UNLOCK_ASK_RE = /申请提升|请提升|提升配额|配额不够|配额不足|配额没有增加|申请配额|配额已满/

/** 访问中断类，优先于「慢/卡顿」质量 */
const ACCESS_BLOCK_RE = /打不开|无法访问|时通时断|不通|访问不了|连不上/
const SLOW_ONLY_RE = /卡顿|(?:突然|非常|很)慢|加载慢|访问慢/
const EXPLICIT_QUALITY_RE = /丢包|延迟|抖动|波动/

/** 专线开通/下单，压过连通性 */
const DC_ORDER_ASK_RE = /下单|订购|申购|地域改不了|改不了地域|接入节点|下单地域/
const DC_CONNECT_ASK_RE = /不通|ping|访问对端|无法访问|连不上|无法连通/

const UNLOCK_APPLY_RE = /申请|请提升|请开通|请帮忙|解售罄|灰度申请/

/** 「仍在用、还没退」：不当退订。不含「未退订成功 / 未释放掉」。 */
const UNSUBSCRIBE_NEGATION_RE = /(?:未退订|没有退订|非退订)(?!成功|掉|完)|(?:未释放|没有释放)(?!成功|掉|完)/
const NORMAL_PROVISION_RE = /正常开通/g
const UNSUBSCRIBE_ASK_RE =
  /请帮我退订|请帮忙退订|请帮我释放|请帮忙释放|无法退订|退订失败|要退订|申请退订/

/**
 * 关键词命中：排除「未退订 / 正常开通」这类否定或状态陈述。
 * @param {string} haystack
 * @param {string} keyword
 */
function textIncludesJourneyKeyword(haystack, keyword) {
  const kw = (keyword || '').toLowerCase()
  if (!kw || !haystack) return false
  let h = haystack
  if (kw === '退订' || kw === '到期退订') {
    h = h.replace(/(?:未退订|没有退订|非退订)(?!成功|掉|完)/g, '')
  }
  if (kw === '释放') {
    h = h.replace(/(?:未释放|没有释放)(?!成功|掉|完)/g, '')
  }
  if (kw === '开通') {
    h = h.replace(NORMAL_PROVISION_RE, '')
  }
  return h.includes(kw)
}

function isUnsubscribeAsk(text) {
  const raw = String(text || '')
  if (/未退订成功|退订未成功|无法退订|退订失败/.test(raw)) return true
  const stripped = raw.replace(UNSUBSCRIBE_NEGATION_RE, '')
  return UNSUBSCRIBE_ASK_RE.test(stripped)
}

function isOrderFreezeIntent(text) {
  return /被冻结|订单冻结|账号冻结/.test(text || '')
}

function isReleaseJourneyNode(l2) {
  return /退订|释放/.test(l2.label || '')
}

function isInvestigateJourneyNode(l2) {
  return /协查|根因定位/.test(l2.label || '')
}

function isOperateFreezeNode(l2) {
  return /冻结|停用/.test(l2.label || '')
}

function isServiceExperienceNode(l1) {
  return l1.id === 'service' || /服务与/.test(l1.label || '')
}

function hasTechnicalLifecycleIssue(text) {
  return /不通|时通时断|冻结|配额|丢包|开通失败|无法访问|不能访问|售罄|灰度|慢|卡顿|超时|打不开|中断|延迟|连不上|专线异常|网络异常|访问异常/.test(
    text || '',
  )
}

function hasStrongInvestigateAsk(text) {
  return /协查|抓包|无法复现|区域代提/.test(text || '')
}

const FAULT_SYMPTOM_RE =
  /不通|时通时断|无法访问|不能访问|访问不了|打不开|超时|卡顿|(?:突然|非常|很)慢|丢包|延迟|中断|连不上|专线异常|网络异常|访问异常/

const BIND_APPLY_RE = /绑定失败|解绑失败|无法绑定|无法解绑|请绑定|请解绑|申请绑定|申请解绑|要绑定|要解绑/
const CREATE_FAIL_RE = /开通失败|订购失败|无法创建|无法订购|创建失败|订购不成功/
const LISTENER_APPLY_RE = /创建监听|修改监听|监听失败|添加监听|配置监听/
const BANDWIDTH_CHANGE_RE = /调整|提升|升降配|扩容|降配/

/**
 * 去掉联系时间、资源 ID、处理意见等，避免弱词撑起步程分。
 * @param {string} [text]
 */
export function stripJourneyTaggingNoise(text) {
  return String(text || '')
    .replace(/【处理意见】[\s\S]*$/g, '')
    .replace(/联系时间[：:][^\n#]*/g, '')
    .replace(/##\s*资源ID[：:][^\n#]*/gi, '')
    .replace(/##\s*产品名称[：:][^\n#]*/g, '')
    .replace(/受理渠道[：:][^\n#]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 金牌模板、OP 追加、仅工单号：没有客户诉求，不打旅程。
 * @param {string} [text]
 */
export function isEmptyJourneyAsk(text) {
  const stripped = stripJourneyTaggingNoise(text)
  if (!stripped || isMeaninglessTicketPlaceholderText(stripped)) return true
  const compact = stripped.replace(/\s+/g, '')
  if (compact.length < 8) return true
  if (FAULT_SYMPTOM_RE.test(stripped) || BIND_APPLY_RE.test(stripped) || CREATE_FAIL_RE.test(stripped)) {
    return false
  }
  if (/重要客户|金牌客户|银牌客户|内部重保/.test(compact)) {
    const rest = compact
      .replace(/&lt;|&gt;|<|>/g, '')
      .replace(/重要客户:?/g, '')
      .replace(/金牌客户;?/g, '')
      .replace(/银牌客户;?/g, '')
      .replace(/内部重保客户;?/g, '')
      .replace(/价值客户;?/g, '')
      .replace(/国计民生[^;]*/g, '')
      .replace(/[;；:：]/g, '')
    if (rest.length < 8) return true
  }
  if (/前置授权|机密信息/.test(stripped) && compact.length < 80) return true
  if (/^操作人[：:]/.test(stripped) && compact.length < 120) return true
  if (/接上个工单|又复现了/.test(stripped) && compact.length < 40) return true
  if (/^(?:20\d{2}\d{10,}X\d+)$/i.test(compact)) return true
  return false
}

function isFaultJourneyIntent(text, opts = {}) {
  if (opts.requestScene === '报障与排错') return true
  if (opts.problemType === '可用性/连通性故障' || opts.problemType === '性能问题') return true
  return FAULT_SYMPTOM_RE.test(text || '')
}

function isConsultDiscoverNode(l1) {
  return l1.id === 'discover' || /咨询|认知|方案与商务/.test(l1.label || '')
}

function isBindResourceNode(l2) {
  return /绑定|解绑/.test(l2.label || '')
}

function isListenerConfigNode(l2) {
  return /监听/.test(l2.label || '')
}

function isOperateSymptomNode(l1, l2) {
  if (l1.id !== 'operate' && !/使用|运行|访问与质量|连通/.test(l1.label || '')) return false
  return /不通|质量|远程|连通|停用|冻结/.test(l2.label || '')
}

/**
 * @param {import('./productTaxonomy.js').JourneyL1} l1
 * @param {{ id?: string; label?: string; description?: string; keywords?: string[] }} l2
 */
function isQuantityQuotaNode(l1, l2) {
  if (/quota/i.test(l2.id || '')) return true
  return /配额/.test(l2.label || '')
}

/**
 * @param {import('./productTaxonomy.js').JourneyL1} l1
 * @param {{ id?: string; label?: string; description?: string; keywords?: string[] }} l2
 */
function isPermissionGrayNode(l1, l2) {
  if (/permission|onboard/i.test(l2.id || '')) return true
  return /灰度|上架/.test(l2.label || '')
}

/**
 * 产品上的「放开限制」落点：配额节点、灰度/订购权限，以及云组网「订购权限」等别名。
 * @param {import('./productTaxonomy.js').JourneyL1} l1
 * @param {{ id?: string; label?: string; description?: string; keywords?: string[] }} l2
 */
function isLimitUnlockFamilyNode(l1, l2) {
  if (isQuantityQuotaNode(l1, l2) || isPermissionGrayNode(l1, l2)) return true
  return /订购权限|权限申请|权限及配额/.test(l2.label || '')
}

/**
 * @param {{ id?: string; label?: string; keywords?: string[] }} l2
 */
function isBandwidthChangeNode(l2) {
  if (/升降配|调整带宽/.test(l2.label || '')) return true
  return (l2.keywords || []).some((kw) => kw === '带宽' || kw === '调整带宽' || kw === '升降配')
}

/**
 * @param {{ label?: string; keywords?: string[] }} l2
 */
function isAzSelectNode(l2) {
  if (/可用区|子网选择/.test(l2.label || '')) return true
  return (l2.keywords || []).some(
    (kw) => kw === '灰掉' || kw === '可用区' || kw === '子网无法选择',
  )
}

/**
 * @param {import('./productTaxonomy.js').JourneyL1} l1
 * @param {{ id?: string; label?: string }} l2
 */
function isCreateOrderNode(l1, l2) {
  if (isLimitUnlockFamilyNode(l1, l2)) return false
  return /创建|申购|订购/.test(l2.label || '')
}

function isBillingConsultNode(l2) {
  return /计费|账单|出账/.test(l2.label || '')
}

function isAccessPreferNode(l2) {
  const label = l2.label || ''
  if (/质量与丢包|丢包与链路|时延慢|网络质量/.test(label)) return false
  return /访问不通|连通性异常/.test(label)
}

function isQualityPreferNode(l2) {
  return /质量与丢包|丢包与链路|时延慢|网络质量/.test(l2.label || '')
}

function isDcProvisionFamily(l1) {
  return l1.id === 'provision' || /开通与交付/.test(l1.label || '')
}

function isDcConnectNode(l2) {
  return /连通性异常/.test(l2.label || '')
}

function isBillingChargeWithoutUnlock(text) {
  const t = text || ''
  if (/未出账/.test(t)) return false
  if (/退订|释放/.test(t)) return false
  if (!BILLING_CHARGE_RE.test(t)) return false
  if (QUOTA_UNLOCK_ASK_RE.test(t) || PERMISSION_UNLOCK_RE.test(t)) return false
  return true
}

function prefersAccessOverQuality(text) {
  const t = text || ''
  if (!ACCESS_BLOCK_RE.test(t) || !SLOW_ONLY_RE.test(t)) return false
  return !EXPLICIT_QUALITY_RE.test(t)
}

/**
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 */
function productHasSplitUnlockNodes(journeys) {
  let quantity = false
  let permission = false
  for (const l1 of journeys || []) {
    for (const l2 of l1.children || []) {
      if (isQuantityQuotaNode(l1, l2)) quantity = true
      if (isPermissionGrayNode(l1, l2)) permission = true
    }
  }
  return quantity && permission
}

/**
 * @param {string} text
 * @returns {'quantity' | 'permission' | 'both' | 'unknown'}
 */
function resolveLimitUnlockFlavor(text) {
  const quantity = QUANTITY_UNLOCK_RE.test(text || '')
  const permission = PERMISSION_UNLOCK_RE.test(text || '')
  if (quantity && permission) return 'both'
  if (quantity) return 'quantity'
  if (permission) return 'permission'
  return 'unknown'
}

/**
 * 客户在申请放开限制（配额/售罄/灰度/订购权限），不是单纯升降配。
 * @param {string} text
 * @param {string} [problemType]
 */
function isLimitUnlockJourneyIntent(text, problemType) {
  if (isBillingChargeWithoutUnlock(text)) return false
  if (String(problemType || '') === LIMIT_UNLOCK_PROBLEM_TYPE) return true
  return QUANTITY_UNLOCK_RE.test(text || '') || PERMISSION_UNLOCK_RE.test(text || '')
}

/**
 * 仅从工单正文匹配旅程，并返回本地置信分数（关键词 +3）
 * @param {string} text
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {string} [taxonomyKey]
 * @param {{ problemType?: string }} [opts]
 * @returns {JourneyTextMatch}
 */
export function matchJourneyFromTextWithScore(text, journeys, taxonomyKey, opts = {}) {
  const cleaned = stripJourneyTaggingNoise(text)
  if (isEmptyJourneyAsk(cleaned)) {
    return { journeyL1: UNKNOWN_L1, journeyL2: UNKNOWN_L2, score: 0 }
  }
  const lower = cleaned.toLowerCase()
  const title = (cleaned.match(/工单标题[：:]([^\n]+)/) || [])[1] || ''
  const titleLower = title.toLowerCase()
  const corpus = titleLower + lower
  const unlockIntent = isLimitUnlockJourneyIntent(corpus, opts.problemType)
  const unlockFlavor = resolveLimitUnlockFlavor(corpus)
  const splitUnlock = productHasSplitUnlockNodes(journeys)
  const faultIntent = !unlockIntent && isFaultJourneyIntent(corpus, opts)

  let bestL1 = UNKNOWN_L1
  let bestL2 = UNKNOWN_L2
  let bestScore = 0

  for (const l1 of journeys) {
    for (const l2 of l1.children) {
      let score = 0
      const desc = (l2.description || '').toLowerCase()
      const descTokens = desc.match(/[\u4e00-\u9fa5]{2,}/g) || []
      for (const kw of l2.keywords || []) {
        if (textIncludesJourneyKeyword(lower, kw)) score += 3
      }
      for (const t of descTokens) {
        if (textIncludesJourneyKeyword(lower, t)) score += 1
      }
      if (l1.description && textIncludesJourneyKeyword(lower, l1.description.slice(0, 6))) {
        score += 1
      }
      if (unlockIntent) {
        const family = isLimitUnlockFamilyNode(l1, l2)
        const quantityNode = isQuantityQuotaNode(l1, l2)
        const permissionNode = isPermissionGrayNode(l1, l2)
        if (splitUnlock) {
          if (unlockFlavor === 'permission' && permissionNode) score += 8
          else if (unlockFlavor === 'quantity' && quantityNode && !permissionNode) score += 8
          else if ((unlockFlavor === 'both' || unlockFlavor === 'unknown') && family) score += 6
        } else if (family) {
          score += 8
        }
        if (isBandwidthChangeNode(l2)) score -= 3
        if (isAzSelectNode(l2) && UNLOCK_APPLY_RE.test(corpus)) score -= 8
        if (isCreateOrderNode(l1, l2)) score -= 3
      } else if (
        isBandwidthChangeNode(l2) &&
        /带宽/.test(corpus) &&
        /调整|提升|升降配|扩容|降配/.test(corpus)
      ) {
        score += 4
      }
      if (isOrderFreezeIntent(corpus) && !isUnsubscribeAsk(corpus)) {
        if (isReleaseJourneyNode(l2)) score -= 8
        if (isOperateFreezeNode(l2)) score += 8
      }
      if (isInvestigateJourneyNode(l2) && !hasStrongInvestigateAsk(corpus)) {
        score -= 6
      }
      if (isServiceExperienceNode(l1) && hasTechnicalLifecycleIssue(corpus)) {
        score -= 8
      }
      if (faultIntent) {
        if (isConsultDiscoverNode(l1)) score -= 8
        if (isBindResourceNode(l2) && !BIND_APPLY_RE.test(corpus)) score -= 6
        if (isBandwidthChangeNode(l2) && !BANDWIDTH_CHANGE_RE.test(corpus)) score -= 6
        if (isCreateOrderNode(l1, l2) && !CREATE_FAIL_RE.test(corpus)) score -= 6
        if (isListenerConfigNode(l2) && !LISTENER_APPLY_RE.test(corpus)) score -= 6
        if (isOperateSymptomNode(l1, l2)) score += 4
      }
      if (isBillingChargeWithoutUnlock(corpus)) {
        if (isBillingConsultNode(l2)) score += 8
        if (isQuantityQuotaNode(l1, l2) || isLimitUnlockFamilyNode(l1, l2) || isCreateOrderNode(l1, l2)) {
          score -= 8
        }
      }
      if (prefersAccessOverQuality(corpus)) {
        if (isAccessPreferNode(l2)) score += 6
        if (isQualityPreferNode(l2)) score -= 8
      }
      if (taxonomyKey === 'dc') {
        const orderAsk = DC_ORDER_ASK_RE.test(corpus)
        const connectAsk = DC_CONNECT_ASK_RE.test(corpus)
        if (orderAsk && !connectAsk) {
          if (isDcProvisionFamily(l1)) score += 6
          if (isDcConnectNode(l2)) score -= 8
        }
      }
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
 * @param {{ problemType?: string }} [opts]
 */
function matchJourneyFromText(text, journeys, taxonomyKey, opts = {}) {
  const { journeyL1, journeyL2 } = matchJourneyFromTextWithScore(text, journeys, taxonomyKey, opts)
  return { journeyL1, journeyL2 }
}

/**
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {RegExp} hint
 */
function findJourneyL1IdByChildHint(journeys, hint) {
  const node = journeys.find(
    (l1) => hint.test(l1.label || '') || (l1.children || []).some((l2) => hint.test(l2.label || '')),
  )
  return node?.id || null
}

/**
 * EIP 正文关键词兜底（不读取请求节点字段）
 * @param {string} corpus
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 */
function inferEipJourneyFromKeywords(corpus, journeys) {
  /** @type {string | null} */
  let l1Id = null
  if (isOrderFreezeIntent(corpus) && !isUnsubscribeAsk(corpus)) {
    l1Id = findJourneyL1IdByChildHint(journeys, /冻结|停用/) || 'operate'
  } else if (
    /退订|释放|删除|到期/.test(corpus.replace(UNSUBSCRIBE_NEGATION_RE, '')) &&
    !UNSUBSCRIBE_NEGATION_RE.test(corpus)
  ) {
    l1Id = 'release'
  } else if (/退订|释放|删除|到期/.test(corpus) && isUnsubscribeAsk(corpus)) {
    l1Id = 'release'
  } else if (/绑定|解绑|网卡|空闲.*ip/i.test(corpus)) l1Id = 'bind'
  else if (/配额/.test(corpus)) l1Id = findJourneyL1IdByChildHint(journeys, /配额/) || 'buy'
  else if (/带宽|升降配/.test(corpus)) l1Id = findJourneyL1IdByChildHint(journeys, /升降配|带宽/) || 'buy'
  else if (/无法访问|不通|外网|ip无法访问/i.test(corpus)) l1Id = 'operate'
  else if (/丢包|波动|ping|延迟/.test(corpus)) l1Id = 'operate'
  else if (/远程|登录|ssh|rdp/.test(corpus)) l1Id = 'operate'
  else if (/流量|监控|查询.*流量/.test(corpus)) l1Id = 'operate'
  else if (/开通|创建/.test(corpus)) l1Id = findJourneyL1IdByChildHint(journeys, /开通|申购|订改续/) || 'buy'
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
 * @param {{ useRequestNode?: boolean; problemType?: string }} [opts]
 */
export function matchJourneyByDescription(text, journeys, taxonomyKey, opts = {}) {
  const textResult = matchJourneyFromText(text, journeys, taxonomyKey, opts)

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
  if (quote && quote.length > 10 && !isMeaninglessTicketPlaceholderText(quote)) {
    return trimInlinePlatformFieldSuffix(quote).slice(0, 300)
  }

  const inlineProblem = text.match(
    /(?:^|\n|\d+[、.．]\s*)【?客户(?:问题|需求)】?\s*[：:]\s*([\s\S]*?)(?=(?:^|\n|\d+[、.．]\s*)【?(?:问题原因|解决方案|处理意见|目前进展|协助)|$)/m,
  )
  if (inlineProblem?.[1]) {
    const body = trimInlinePlatformFieldSuffix(inlineProblem[1].trim())
    if (body && !isMeaninglessTicketPlaceholderText(body)) return body.slice(0, 300)
  }

  const title = text.match(/工单标题[：:]([^\n]+)/)
  if (title) return title[1].trim().slice(0, 300)
  const demand = text.match(/客户需求[：:]([^\n|]+)/)
  if (demand) return demand[1].trim().slice(0, 300)
  const detail = text.match(/详细内容[：:]([^\n|]+)/)
  if (detail) return detail[1].trim().slice(0, 300)

  const fallback = text.slice(0, 200).replace(/\s+/g, ' ').trim()
  if (!fallback || isMeaninglessTicketPlaceholderText(fallback)) return ''
  if (/^【处理意见】/.test(fallback)) return ''
  return fallback
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
