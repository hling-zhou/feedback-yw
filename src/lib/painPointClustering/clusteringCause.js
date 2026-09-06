import { getComplaintCauseL1Final } from '../../domain/complaintCause.js'

/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */

/**
 * 投诉原因树一/二级（组织归责）标签——禁止作为问题原因聚类轴或类名。
 * 来源：src/data/complaintCauseTaxonomy.json
 */
export const ORG_BLAME_L1_LABELS = new Set([
  '云能问题',
  '外单位问题',
  '客户体验类投诉',
  '客户体验类',
])

export const ORG_BLAME_L2_LABELS = new Set([
  '产品原因',
  '运维原因',
  '资源不足',
  '安全原因',
  '故障无法复现',
  '引入合作方原因',
  '计划建设原因',
  '业务原因',
  '一线原因',
  '任务单排查中',
  '政企BOSS/ESP问题',
  '移动云外部网络问题',
  '省侧原因',
  '管局问题',
  '操作系统配置问题（OS与OS内部）',
  '业务应用或需求问题（自身业务与应用）',
  '产品控制台配置问题',
  '安全问题（客户被攻击或自身对外攻击）',
  '云电脑客户端配置与硬件适配问题',
  '业务平台（官网业务平台使用与业务规则）',
  '开放云市场',
  '客户配合问题',
  '客户其他问题',
])

/** 占位/未定位文本（不当问题原因用） */
const PLACEHOLDER_RE =
  /^(?:无|暂无|未知|未提供|待补充|待分析|无法复现|根因未明|问题定位中|不涉及|n\/a|na|—|-+|\.+|\\+|\/+)$/i

/** 终判路径分隔符 */
const TREE_PATH_SEP_RE = /\s*\/\s*/

/**
 * 是否为组织归责文本（一/二级标签或终判路径拼接）
 * @param {string} text
 */
export function isOrganizationalCauseText(text) {
  const t = (text || '').trim()
  if (!t) return true
  if (PLACEHOLDER_RE.test(t)) return true
  // 整段就是一/二级标签
  if (ORG_BLAME_L1_LABELS.has(t) || ORG_BLAME_L2_LABELS.has(t)) return true
  // 终判路径拼接：每段都是一/二级或三级，且至少含一个一/二级
  const segments = t.split(TREE_PATH_SEP_RE).map((s) => s.trim()).filter(Boolean)
  if (segments.length >= 2) {
    const allLabels = new Set([...ORG_BLAME_L1_LABELS, ...ORG_BLAME_L2_LABELS])
    const hasOrgLevel = segments.some((s) => ORG_BLAME_L1_LABELS.has(s) || ORG_BLAME_L2_LABELS.has(s))
    const allKnownOrShort = segments.every((s) => allLabels.has(s) || s.length <= 8)
    if (hasOrgLevel && allKnownOrShort) return true
  }
  return false
}

/**
 * 从可能含终判路径的文本中剥出一/二级，只留三级或机制句。
 * 若剥开后只剩一/二级或占位，返回空（调用方应改读 complaintCauseL3Final）。
 * @param {string} text
 */
export function stripOrgBlamePath(text) {
  const t = (text || '').trim()
  if (!t) return ''
  if (PLACEHOLDER_RE.test(t)) return ''
  // 整段就是一/二级
  if (ORG_BLAME_L1_LABELS.has(t) || ORG_BLAME_L2_LABELS.has(t)) return ''
  // 终判路径：取最后一段非一/二级
  const segments = t.split(TREE_PATH_SEP_RE).map((s) => s.trim()).filter(Boolean)
  if (segments.length >= 2) {
    const tail = segments[segments.length - 1]
    // 末段若是一/二级，整段丢弃
    if (ORG_BLAME_L1_LABELS.has(tail) || ORG_BLAME_L2_LABELS.has(tail)) return ''
    // 末段是三级或机制句，保留末段
    return tail
  }
  return t
}

/**
 * 取工单的「问题原因」聚类文本（已剥组织归责）。
 * 优先级：rootCauseReview（非归责树）→ 可判定的 rootCause → complaintCauseL3Final → 空
 * @param {FeedbackRecord} record
 */
export function getClusteringCauseText(record) {
  // 1. 人工复核问题原因（最可信）
  const review = (record?.rootCauseReview || '').trim()
  if (review && !isOrganizationalCauseText(review)) return review

  // 2. 系统 rootCause（规则/导入/LLM），剥掉一/二级路径
  const rawRootCause = (record?.rootCause || '').trim()
  if (rawRootCause && rawRootCause !== '待分析') {
    const stripped = stripOrgBlamePath(rawRootCause)
    if (stripped && !isOrganizationalCauseText(stripped)) return stripped
  }

  // 3. 投诉原因三级（最多用三级）
  const l3 = (record?.complaintCauseL3Final || '').trim()
  if (l3 && l3 !== '/' && !isOrganizationalCauseText(l3)) return l3

  return ''
}

/**
 * 取问题原因的归一化分组键（用于一次聚类同因合并）。
 * @param {FeedbackRecord} record
 */
export function getClusteringCauseKey(record) {
  const text = getClusteringCauseText(record)
  if (!text) return ''
  return text.replace(/\s+/g, '').toLowerCase()
}

/**
 * 两条工单的问题原因是否兼容（可合并）。
 * - 双方都无可用原因 → null（退回痛点相似度）
 * - 双方都有原因且归一化后相同 → true（同因，可合并）
 * - 双方都有原因但不同 → false（异因，禁止合并，即使痛点很像）
 * - 一方有一方无 → false（有因的不能被无因的吞掉）
 * @param {FeedbackRecord} a
 * @param {FeedbackRecord} b
 * @returns {boolean | null}
 */
export function causesCompatible(a, b) {
  const keyA = getClusteringCauseKey(a)
  const keyB = getClusteringCauseKey(b)
  if (!keyA && !keyB) return null
  if (!keyA || !keyB) return false
  return keyA === keyB
}

/**
 * 一组工单的问题原因多数代表（用于类名）。
 * 取频次最高（并列取最长）的问题原因文本；无则空。
 * @param {FeedbackRecord[]} records
 */
export function pickRepresentativeCause(records) {
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const r of records || []) {
    const cause = getClusteringCauseText(r)
    if (!cause) continue
    map.set(cause, (map.get(cause) || 0) + 1)
  }
  if (!map.size) return ''
  let best = ''
  let bestCount = 0
  for (const [text, count] of map) {
    if (count > bestCount || (count === bestCount && text.length > best.length)) {
      best = text
      bestCount = count
    }
  }
  return best
}

/**
 * 一组工单中有可用问题原因的占比（0~1）。
 * @param {FeedbackRecord[]} records
 */
export function causeCoverageRate(records) {
  const total = (records || []).length
  if (!total) return 0
  const withCause = (records || []).filter((r) => getClusteringCauseText(r)).length
  return withCause / total
}
