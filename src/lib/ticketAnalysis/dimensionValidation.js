/**
 * 维度标签层级验证 (Dimension Validation Gates)
 *
 * 三道闸门构成从源头到下游的完整验证链：
 *
 * L0 闸门（customerRequest 质量 + 意图可信度）：
 *   - 确保 customerRequest 非空/非模板/非占位符
 *   - 确保 extractIntent confidence >= medium（至少有一个维度命中）
 *   - 未通过时：重试（扩大语料→处理意见补入→LLM 介入），仍不通过标 manual_review
 *   - 如果 L0 不准，后面全是无意义的——这是整条链路的地基
 *
 * L1 闸门（requestScene × problemType 一致性）：
 *   - 确保两者都非空/非默认值
 *   - 确保两者逻辑一致（不会出现"报障+配额"类矛盾）
 *   - 未通过时：重试（回退旧分类器→路径兜底→LLM），仍不通过标 manual_review
 *
 * L2 闸门（journeyL1/journeyL2 有效性）：
 *   - 确保旅程非空/非"无法识别"
 *   - 确保旅程与 requestScene 方向一致
 *   - 未通过时：重试（路径兜底→默认旅程），仍不通过标 manual_review
 */

import { isUnrecognizedTag, TAG_UNRECOGNIZED } from './tagLabels.js'
import {
  isMeaninglessTicketPlaceholderText,
} from '../taggingText.js'
import {
  isFormattedTemplateContent,
  isPlatformOutcomeContent,
  isCustomerDemandLike,
} from './customerRequestFilters.js'

// ============================================================
// L0 闸门：customerRequest 质量 + 意图可信度
// ============================================================

/** customerRequest 最小有效长度 */
const MIN_CR_LEN = 4

/**
 * 检查 customerRequest 文本是否为有效客户诉求（非空/非模板/非占位符/非平台结论）
 * @param {string} cr
 * @returns {{ valid: boolean, reason: string }}
 */
function checkCustomerRequestQuality(cr) {
  const t = (cr || '').trim()
  if (!t) return { valid: false, reason: 'customerRequest 为空' }
  if (isMeaninglessTicketPlaceholderText(t)) return { valid: false, reason: 'customerRequest 为占位符' }
  if (isFormattedTemplateContent(t)) return { valid: false, reason: 'customerRequest 为模板字段堆叠' }
  if (isPlatformOutcomeContent(t)) return { valid: false, reason: 'customerRequest 为平台处理结论而非客户诉求' }
  if (!isCustomerDemandLike(t)) return { valid: false, reason: 'customerRequest 不含客户诉求信号' }
  if (t.length < MIN_CR_LEN) return { valid: false, reason: `customerRequest 长度不足（<${MIN_CR_LEN}字）` }
  return { valid: true, reason: '' }
}

/**
 * L0 验证：customerRequest 质量是否过关 + 意图提取可信度
 *
 * L0 是整条打标链路的地基：如果 customerRequest 抓错了或意图提取为 low，
 * 后续 scene/problemType/journey/optimization 全部建立在错误基础上。
 *
 * 兜底逻辑：action="其他" 意味着意图未能判定 → 即使 confidence=medium
 * （因为 domain 命中了），action 不确定会导致 requestScene 映射到默认值
 * （产品信息咨询），可能不准。因此 action="其他" 标 weak_signal 触发重试。
 *
 * @param {{ customerRequest?: string, confidence?: string, action?: string }} input
 * @returns {{ pass: boolean, issues: string[], grade: 'ok'|'weak_signal'|'incomplete' }}
 */
export function validateL0({ customerRequest, confidence, action } = {}) {
  const issues = []

  // 1. customerRequest 质量检查
  const crCheck = checkCustomerRequestQuality(customerRequest)
  if (!crCheck.valid) {
    issues.push(crCheck.reason)
    return { pass: false, issues, grade: 'incomplete' }
  }

  // 2. 意图置信度检查
  if (!confidence || confidence === 'low') {
    issues.push(`意图置信度为 ${confidence || 'undefined'}，信号不足`)
    return { pass: false, issues, grade: 'weak_signal' }
  }

  // 3. action 兜底检查：action="其他" 意味着意图未能判定，标 weak_signal
  if (action === '其他') {
    issues.push('意图 action 为"其他"，无法确定场景方向')
    return { pass: false, issues, grade: 'weak_signal' }
  }

  return { pass: true, issues: [], grade: 'ok' }
}

// ============================================================
// L1 闸门：requestScene × problemType 一致性
// ============================================================

/**
 * 已知的场景-类型不一致模式（基于 v3 审计 349+130+40 条发现）
 */
const L1_CONFLICT_PATTERNS = [
  // 配额操作不应在报障场景
  { scene: '报障与排错', typePattern: /配额与权限申请/, conflict: '报障场景不应有配额工单' },
  // 咨询不应在报障场景
  { scene: '报障与排错', typePattern: /产品功能咨询/, conflict: '报障场景不应有咨询工单' },
  // 退订/订购操作不应在咨询场景
  { scene: '产品信息咨询', typePattern: /退订与释放|资源开通与创建/, conflict: '咨询场景不应有操作类工单' },
  // 报障场景必须配故障/性能/配置/安全类 problemType（操作困难也是报障）
  { scene: '报障与排错', typePattern: /^(?!可用性|性能|配置与操作|DNS证书与安全策略|退订与释放|资源开通与创建|其他$).*$/, conflict: '报障场景需配故障/性能/配置/安全/其他 type' },
]

/**
 * L1 验证：检查 requestScene 和 problemType 是否一致
 *
 * @param {{ requestScene: string, problemType: string, confidence?: string }} input
 * @returns {{ pass: boolean, issues: string[], grade: 'ok'|'conflict'|'incomplete' }}
 */
export function validateL1({ requestScene, problemType, confidence } = {}) {
  const issues = []

  // 完整性检查
  if (!requestScene || isUnrecognizedTag(requestScene)) {
    issues.push('requestScene 为空或无法识别')
    return { pass: false, issues, grade: 'incomplete' }
  }
  if (!problemType || isUnrecognizedTag(problemType) || problemType === '产品功能咨询') {
    // "产品功能咨询" 是默认兜底，视为弱信号
    issues.push('problemType 为默认值或无法识别')
    return { pass: false, issues, grade: 'incomplete' }
  }

  // 一致性检查：已知矛盾模式
  for (const { scene, typePattern, conflict } of L1_CONFLICT_PATTERNS) {
    if (requestScene === scene && typePattern.test(problemType)) {
      issues.push(conflict)
      return { pass: false, issues, grade: 'conflict' }
    }
  }

  // 低置信度降低等级
  if (confidence === 'low') {
    return { pass: true, issues: ['置信度低'], grade: 'incomplete' }
  }
  if (confidence === 'medium') {
    return { pass: true, issues: ['置信度中'], grade: 'incomplete' }
  }

  return { pass: true, issues: [], grade: 'ok' }
}

// ============================================================
// L2 闸门：journeyL1/journeyL2 有效性
// ============================================================

/**
 * journey 方向与 requestScene 的预期对照
 */
const JOURNEY_SCENE_EXPECTATIONS = {
  '报障与排错': /故障|异常|不通|连通|排查|运行|质量|性能|中断|配置|规则|绑定/,
  '资源操作申请': /开通|申领|订购|创建|退订|释放|变更|扩容|配额|带宽|接入|上架|规则|绑定/,
  '产品信息咨询': /认知|选型|方案|商务|咨询/,
  操作指导: /配置|绑定|操作|使用/,
}

/**
 * 宽容场景集：这些 requestScene 本身语义较泛，journey 跨域时判 compatible 而非 mismatch。
 * - 产品信息咨询/方案咨询与设计：咨询可能覆盖认知/方案/计费等多旅程
 * - 费用与账务：费用问题可能涉及开通/认知/流程等多旅程
 * - 服务申诉与投诉：投诉可能涉及任何旅程
 */
const LENIENT_SCENES = new Set([
  '产品信息咨询',
  '方案咨询与设计',
  '费用与账务',
  '服务申诉与投诉',
])

/**
 * L2 验证：检查 journey 是否有效且与 requestScene 方向一致
 *
 * @param {{ journeyL1: string, journeyL2: string, requestScene: string }} input
 * @returns {{ pass: boolean, issues: string[], grade: 'ok'|'mismatch'|'incomplete' }}
 */
export function validateL2({ journeyL1, journeyL2, requestScene } = {}) {
  const issues = []

  // 完整性
  if (!journeyL1 || isUnrecognizedTag(journeyL1) || journeyL1 === TAG_UNRECOGNIZED) {
    issues.push('journeyL1 为空或无法识别')
    return { pass: false, issues, grade: 'incomplete' }
  }
  if (!journeyL2 || isUnrecognizedTag(journeyL2) || journeyL2 === TAG_UNRECOGNIZED) {
    issues.push('journeyL2 为空或无法识别')
    return { pass: false, issues, grade: 'incomplete' }
  }

  // 方向一致性：journeyL1 描述的方向是否与 requestScene 匹配
  // 宽容场景（咨询/费用/投诉）跨旅程不判 mismatch——这些场景语义泛，journey 容错高
  const expectedPattern = JOURNEY_SCENE_EXPECTATIONS[requestScene]
  if (expectedPattern && !expectedPattern.test(journeyL1)) {
    if (LENIENT_SCENES.has(requestScene)) {
      // 宽容场景：记录提示但不 fail
      return { pass: true, issues: [`journeyL1="${journeyL1}" 与 requestScene="${requestScene}" 方向偏移（宽容场景）`], grade: 'ok' }
    }
    issues.push(`journeyL1="${journeyL1}" 与 requestScene="${requestScene}" 方向不一致`)
    return { pass: false, issues, grade: 'mismatch' }
  }

  return { pass: true, issues: [], grade: 'ok' }
}

// ============================================================
// 闸门总调度
// ============================================================

/**
 * 根据闸门层级和 grade 计算 tagStatus
 * @param {'L0'|'L1'|'L2'} level
 * @param {string} grade
 * @returns {string}
 */
export function gateStatus(level, grade) {
  if (grade === 'ok') return 'ok'
  return `manual_review`
}

/**
 * 将多个闸门结果合并为最终 tagStatus
 * 任何一个闸门标 manual_review → 最终 manual_review
 * 任何 incomplete 但不 manual_review 的 → 保留最高级别的问题
 * @param {Array<{ level: string, grade: string, pass: boolean }>} results
 * @returns {string}
 */
export function mergeGateStatuses(results) {
  for (const r of results) {
    if (!r.pass) return 'manual_review'
  }
  return 'ok'
}