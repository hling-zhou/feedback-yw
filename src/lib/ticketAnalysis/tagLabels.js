/** 四维打标：完全无法匹配 */
export const TAG_UNRECOGNIZED = '无法识别'

/** @deprecated 兼容旧数据，读取时映射为 TAG_UNRECOGNIZED */
export const TAG_LEGACY_UNCLASSIFIED = '未分类'

export const TAG_LEGACY_JOURNEY_L1_UNKNOWN = '未识别环节'
export const TAG_LEGACY_JOURNEY_L2_UNKNOWN = '未识别子环节'

export const TAG_PENDING_REVIEW_PREFIX = '待复核标签/'

/**
 * @param {string | undefined | null} label
 */
export function isPendingReviewTag(label) {
  return Boolean(label?.startsWith(TAG_PENDING_REVIEW_PREFIX))
}

/**
 * @param {string | undefined | null} label
 */
export function isUnrecognizedTag(label) {
  const t = label?.trim()
  if (!t) return true
  return (
    t === TAG_UNRECOGNIZED ||
    t === TAG_LEGACY_UNCLASSIFIED ||
    t === TAG_LEGACY_JOURNEY_L1_UNKNOWN ||
    t === TAG_LEGACY_JOURNEY_L2_UNKNOWN
  )
}

/**
 * @param {string | undefined | null} label
 * @param {'dimension' | 'journeyL1' | 'journeyL2'} [kind]
 */
export function normalizeTagLabel(label, kind = 'dimension') {
  const t = label?.trim()
  if (!t) return TAG_UNRECOGNIZED
  if (isPendingReviewTag(t)) return t
  if (t === TAG_LEGACY_UNCLASSIFIED || t === TAG_UNRECOGNIZED) return TAG_UNRECOGNIZED
  if (kind === 'journeyL1' && t === TAG_LEGACY_JOURNEY_L1_UNKNOWN) return TAG_UNRECOGNIZED
  if (kind === 'journeyL2' && t === TAG_LEGACY_JOURNEY_L2_UNKNOWN) return TAG_UNRECOGNIZED
  return t
}

/**
 * @param {string} hint
 */
export function pendingReviewTag(hint) {
  const body = (hint || '').trim().slice(0, 40)
  return body ? `${TAG_PENDING_REVIEW_PREFIX}${body}` : TAG_UNRECOGNIZED
}

/** 常见请求节点段 3 → 请求场景（精确匹配，禁止模糊） */
export const DEFAULT_REQUEST_SCENE_PATH_MAP = {
  故障报修: '报障与排错',
  报障: '报障与排错',
  产品使用问题: '产品信息咨询',
  产品咨询: '产品信息咨询',
  产品功能: '产品信息咨询',
  产品使用: '产品信息咨询',
  开通申请: '资源操作申请',
  资源开通: '资源操作申请',
  进度查询: '进度催办与协同',
  其他: '产品信息咨询',
}

/** 常见请求节点段 4 → 问题类型（精确匹配标签名或别名，目标为 12 类新标签） */
export const DEFAULT_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性': '可用性/连通性故障',
  可用性与连通性: '可用性/连通性故障',
  '可用性/故障': '可用性/连通性故障',
  IP无法访问: '可用性/连通性故障',
  功能异常与缺陷: '可用性/连通性故障',
  安全与合规: '可用性/连通性故障',
  '公网IP绑定/解绑失败': '配置与操作',
  配置与绑定: '配置与操作',
  配置与对接: '配置与操作',
  配置与运维: '配置与操作',
  性能类: '性能问题',
  '性能与稳定性': '性能问题',
  性能与质量: '性能问题',
  计费账单: '计费与账单',
  计费与商务: '计费与账单',
  开通与配额: '配额与权限申请',
  资源与配额: '资源开通与创建',
  产品咨询: '产品功能咨询',
  咨询与规则: '产品功能咨询',
  功能与咨询: '产品功能咨询',
  产品功能: '产品功能咨询',
  功能需求: '产品功能需求',
  功能需求与规划: '产品功能需求',
  易用性体验: '界面与操作易用性',
  客户体验类: '界面与操作易用性',
  退订与释放: '退订与释放',
  '流程与服务': '人工服务与流程',
}
