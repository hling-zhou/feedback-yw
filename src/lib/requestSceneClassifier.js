import { REQUEST_SCENES_BUILTIN } from './sharedTagDefs.js'

/** @typedef {import('./sharedTagDefs.js').SharedTagRule} SharedTagRule */

export const REQUEST_SCENE_FAULT = '报障与排错'
export const REQUEST_SCENE_RESOURCE = '资源操作申请'
export const REQUEST_SCENE_GUIDE = '操作指导'
export const REQUEST_SCENE_PROGRESS = '进度催办与协同'
export const REQUEST_SCENE_PRODUCT_INFO = '产品信息咨询'
export const REQUEST_SCENE_SOLUTION = '方案咨询与设计'
export const REQUEST_SCENE_BILLING = '费用与账务'
export const REQUEST_SCENE_INFO_QUERY = '信息查询'
export const REQUEST_SCENE_COMPLAINT = '服务申诉与投诉'
/** 无有效关键词时的默认类（对齐规则文档 §5） */
export const REQUEST_SCENE_DEFAULT = REQUEST_SCENE_PRODUCT_INFO

/** 决策树优先级顺序（与 REQUEST_SCENES_BUILTIN 一致） */
export const REQUEST_SCENE_CLASSIFIER_ORDER = REQUEST_SCENES_BUILTIN.map((r) => r.label)

const CONSULT_INTENT_RE = /如何|怎么|怎样|请问/
const OPERATION_FAILURE_RE = /失败|报错|无法|错误|不生效|异常|请帮忙处理|请帮忙/

const FAULT_SLOW_CONSULT_RE = /为什么慢|为何慢|为什么这么慢|怎么.*慢[^了]|慢[^了].*原因/

/**
 * @param {string} text
 */
function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

/**
 * @param {string} text
 */
function hasConsultIntent(text) {
  return CONSULT_INTENT_RE.test(text)
}

/**
 * @param {string} text
 */
function isResourceOpFailure(text) {
  return (
    /退订|释放|申购|开通|创建/.test(text) &&
    (OPERATION_FAILURE_RE.test(text) || /请帮忙/.test(text))
  )
}

/**
 * @param {string} text
 */
function matchesFault(text) {
  if (FAULT_SLOW_CONSULT_RE.test(text) && !/(不通|中断|故障|报错|异常|不可用|掉线|崩溃)/.test(text)) {
    return false
  }
  if (isResourceOpFailure(text)) return false

  return (
    /不通|掉线|中断|报错|崩溃|封堵|攻击|卡顿|慢|排查原因|抓包|解封|恢复|重启|无法访问|连接失败|超时|丢包|宕机|异常|故障|不可用|502|503|报障/.test(
      text,
    ) ||
    /无法ping|ping不通|不能访问/.test(text.toLowerCase())
  )
}

/**
 * @param {string} text
 */
function matchesResourceApplication(text) {
  if (/如何[^。，；\n]{0,16}退订|怎么[^。，；\n]{0,16}退订|怎样[^。，；\n]{0,16}退订/.test(text)) {
    return false
  }
  if (/如何[^。，；\n]{0,16}释放|怎么[^。，；\n]{0,16}释放|怎样[^。，；\n]{0,16}释放/.test(text)) {
    return false
  }
  if (
    /如何[^。，；\n]{0,16}申请|怎么[^。，；\n]{0,16}申请|怎样[^。，；\n]{0,16}申请/.test(text) &&
    !OPERATION_FAILURE_RE.test(text)
  ) {
    return false
  }

  if (isResourceOpFailure(text)) return true
  if (/解除[^。，；\n]{0,8}售罄|解售罄/.test(text)) return true
  if (
    /申请|提升配额|扩容|增加IP|轻载IP|灰度|解除8:1|开通权限|上架|申购|增加.*配额|申请.*权限/.test(
      text,
    )
  ) {
    return true
  }
  if (/退订|释放/.test(text) && !hasConsultIntent(text)) return true
  if (/提升|扩容/.test(text) && /配额|带宽|IP/.test(text) && /申请|请/.test(text)) return true

  return false
}

/**
 * @param {string} text
 */
function isQuotaRuleConsult(text) {
  return (
    /怎么提升|如何提升|需联系谁|带宽不够.*怎么|怎么.*配额|如何.*配额/.test(text) &&
    !/申请|请帮忙提升|请提升/.test(text)
  )
}

/**
 * @param {string} text
 */
function matchesOperationGuide(text) {
  if (isQuotaRuleConsult(text)) return false
  if (OPERATION_FAILURE_RE.test(text) && /绑定|解绑|修改|退订|释放|配置/.test(text)) {
    return false
  }

  if (hasConsultIntent(text)) return true

  return (
    /操作步骤|配置方法|最佳实践|教程|设置|步骤|方法|怎么用|如何配置/.test(text) ||
    (/绑定|解绑|修改/.test(text) && !OPERATION_FAILURE_RE.test(text))
  )
}

/**
 * @param {string} text
 */
function matchesProgress(text) {
  if (/能帮忙催|催下|尽快审批/.test(text) && /申请|配额|提升/.test(text)) {
    return false
  }
  if (/投诉/.test(text) && /再不解决|态度|不满|要求赔偿|投诉到/.test(text)) {
    return false
  }

  return (
    /催办|进度|查询订单|审批状态|建群|协查|补充材料|何时完成|帮忙跟进|协助处理|等了多久|还没好|处理到哪了|没人回|开通中.*催/.test(
      text,
    ) || /订单状态.*催/.test(text)
  )
}

/**
 * @param {string} text
 */
function matchesProductInfo(text) {
  if (isQuotaRuleConsult(text)) return true

  return (
    /是否支持|规格|能力|功能说明|价格|多少钱|资费|区别|对比|支持.*吗|能不能|有什么功能|产品介绍|咨询/.test(
      text,
    ) || /带宽不够|需联系谁/.test(text)
  )
}

/**
 * @param {string} text
 */
function matchesSolution(text) {
  return /方案|架构|选型|迁移|割接|落地|组网|规划|设计|跨区域|容灾|高可用|如何实现.*架构/.test(text)
}

/**
 * @param {string} text
 */
function matchesBilling(text) {
  if (hasConsultIntent(text) && /账单|计费/.test(text) && !/多扣|少扣|异常|不对/.test(text)) {
    return false
  }
  return /账单|扣费|退款|发票|对账|欠费|费用异常|多扣|少扣|怎么收费|计费规则|退费|冲销|出账/.test(
    text,
  )
}

/**
 * @param {string} text
 */
function matchesInfoQuery(text) {
  if (/催办|催下|尽快/.test(text)) return false

  return (
    /查[^。，；\n]{0,12}有效期|查[^。，；\n]{0,12}备案|查[^。，；\n]{0,12}归属|查[^。，；\n]{0,12}状态/.test(
      text,
    ) ||
    /是否还在|有没有[^。，；\n]{0,12}记录|查询[^。，；\n]{0,12}额度|核对[^。，；\n]{0,12}信息|查询IP配额/.test(
      text,
    )
  )
}

/**
 * @param {string} text
 */
function matchesServiceComplaint(text) {
  return (
    /投诉|不满|态度差|升级处理|回访|响应慢|无人跟进|投诉到集团|要求赔偿|差评|服务太差|再不解决就投诉|服务差|督办/.test(
      text,
    ) || (/投诉/.test(text) && /没人回|两天|再不解决/.test(text))
  )
}

/** @type {Record<string, (text: string) => boolean>} */
const MATCHERS = {
  [REQUEST_SCENE_FAULT]: matchesFault,
  [REQUEST_SCENE_RESOURCE]: matchesResourceApplication,
  [REQUEST_SCENE_GUIDE]: matchesOperationGuide,
  [REQUEST_SCENE_PROGRESS]: matchesProgress,
  [REQUEST_SCENE_PRODUCT_INFO]: matchesProductInfo,
  [REQUEST_SCENE_SOLUTION]: matchesSolution,
  [REQUEST_SCENE_BILLING]: matchesBilling,
  [REQUEST_SCENE_INFO_QUERY]: matchesInfoQuery,
  [REQUEST_SCENE_COMPLAINT]: matchesServiceComplaint,
}

/**
 * 按决策树优先级逐级匹配（复合场景取首个命中）
 * @param {string} text
 * @param {SharedTagRule[]} [rules]
 * @returns {string | null}
 */
export function matchRequestSceneByDecisionTree(text, rules = REQUEST_SCENES_BUILTIN) {
  const t = normalizeText(text)
  if (!t) return null

  for (const rule of rules) {
    const label = rule.label?.trim()
    if (!label) continue
    const fn = MATCHERS[label]
    if (fn?.(t)) return label
  }
  return null
}

/**
 * 请求场景决策树分类（对齐 data/请求场景标签体系及打标规则.md V2.0）
 *
 * @param {string} text
 * @param {SharedTagRule[]} [rules]
 * @returns {string}
 */
export function classifyRequestScene(text, rules = REQUEST_SCENES_BUILTIN) {
  const matched = matchRequestSceneByDecisionTree(text, rules)
  return matched || REQUEST_SCENE_DEFAULT
}
