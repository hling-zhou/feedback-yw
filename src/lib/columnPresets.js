/**
 * 列映射预设（按数据来源）
 * @typedef {import('./parseFile.js').ColumnPreset} ColumnPreset
 */

import { PRIMARY_TICKET_ID_HEADERS } from './parseFile.js'

/**
 * @param {string[]} headers
 */
function hasPrimaryTicketIdHeader(headers) {
  return PRIMARY_TICKET_ID_HEADERS.some((name) => headers.includes(name))
}

/** @type {ColumnPreset} */
export const MOBILE_CLOUD_TICKET_PRESET = {
  id: 'mobile-cloud-ticket',
  name: '移动云投诉工单',
  description:
    '以「处理意见」为主进行四维打标（请求场景、问题类型、用户旅程、用户情绪），并生成客户请求内容、需求痛点挖掘与优化建议（规则初标，导入后 LLM 增强）；受理内容用于抽取客户原话',
  dataSourceTypes: ['complaint_ticket'],
  columnMap: {
    ticketId: '工单流水号',
    createdAt: '受理时间',
    productSpec: '具体投诉产品',
    resourcePool: '所属资源池',
    customerTierCol: '移动云客户服务等级',
    source: '受理渠道',
    rawText: '受理内容',
    handlingText: '处理意见',
    responseText: '优化举措/建议',
    rootCauseCol: '问题原因',
    problemTypeL1FinalCol: '投诉原因 一级（终判）',
    problemTypeL2FinalCol: '投诉原因 二级（终判）',
    problemTypeL3FinalCol: '投诉原因 三级（终判）',
  },
  rawTextMerge: ['追加信息'],
}

/** @type {ColumnPreset} */
export const CONSULTATION_TICKET_PRESET = {
  id: 'consultation-ticket',
  name: '咨询工单',
  description:
    '与投诉工单类似；优先映射处理意见 / 咨询答复列；含客户请求、需求痛点与优化建议分析',
  dataSourceTypes: ['consultation_ticket'],
  columnMap: {
    ticketId: '工单流水号',
    createdAt: '受理时间',
    productSpec: '具体投诉产品',
    resourcePool: '所属资源池',
    customerTierCol: '移动云客户服务等级',
    source: '受理渠道',
    rawText: '受理内容',
    handlingText: '处理意见',
    responseText: '优化举措/建议',
    rootCauseCol: '问题原因',
  },
  rawTextMerge: ['追加信息'],
}

/** @type {ColumnPreset} */
export const POST_USE_RATING_PRESET = {
  id: 'post-use-rating',
  name: '用后即评',
  description: '评分与评论列（统计分析能力后续补充）',
  dataSourceTypes: ['post_use_rating'],
  columnMap: {
    createdAt: '评价时间',
    productSpec: '产品',
    commentText: '评价内容',
    rawText: '评价内容',
  },
  rawTextMerge: [],
}

/** @type {ColumnPreset} */
export const USER_SURVEY_PRESET = {
  id: 'user-survey',
  name: '用户调研',
  description: '调研题目与作答列',
  dataSourceTypes: ['user_survey'],
  columnMap: {
    createdAt: '提交时间',
    productSpec: '产品',
    openText: '开放回答',
    rawText: '开放回答',
  },
  rawTextMerge: [],
}

/** @type {ColumnPreset} */
export const GENERIC_PRESET = {
  id: 'generic',
  name: '通用文本',
  description: '标题 + 正文或单一文本列',
  dataSourceTypes: ['other'],
  columnMap: {
    createdAt: '时间',
    rawText: '内容',
    handlingText: '内容',
  },
  rawTextMerge: [],
}

/** @type {ColumnPreset} */
export const SATISFACTION_CALLBACK_PRESET = {
  id: 'satisfaction-callback',
  name: '满意度回访记录',
  description: '回访工单与原工单匹配，补全投诉/咨询工单的回访满意度（不新增独立评价记录）',
  dataSourceTypes: ['post_use_rating'],
  columnMap: {
    followUpTicketId: '回访工单编号',
    originalTicketId: '原工单编号',
    productSpec: '具体投诉产品',
    followUpSuccessful: '是否回访成功',
    problemResolved: '之前您反映的问题是否得到解决',
    score: '请您对本次投诉的整体服务情况进行评价',
    overallService: '整体服务情况不满意原因',
    handlingDurationScore: '请您对问题处理时长进行评价',
    handlingDurationReason: '处理时长不满意原因',
    staffAttitudeScore: '请您对服务人员的服务态度进行评价',
    staffAttitudeReason: '服务人员的服务态度不满意原因',
    staffCapabilityScore: '请您对服务人员的业务能力进行评价',
    staffCapabilityReason: '服务人员的业务能力不满意原因',
    phoneCallbackOpinion: '电话回访意见',
    remark: '备注',
  },
  rawTextMerge: [],
}

/** @type {ColumnPreset[]} */
export const COLUMN_PRESETS = [
  MOBILE_CLOUD_TICKET_PRESET,
  CONSULTATION_TICKET_PRESET,
  POST_USE_RATING_PRESET,
  USER_SURVEY_PRESET,
  SATISFACTION_CALLBACK_PRESET,
  GENERIC_PRESET,
]

/**
 * @param {string[]} headers
 * @param {import('../domain/enums.js').DataSourceType} [dataSourceType]
 * @param {{ postUseRatingSubType?: import('../domain/postUseRatingImport.js').PostUseRatingImportSubType }} [options]
 * @returns {ColumnPreset | null}
 */
export function detectPreset(headers, dataSourceType = 'complaint_ticket', options = {}) {
  const { postUseRatingSubType } = options
  const has = (name) => headers.includes(name)
  const isCallbackHeaders = has('回访工单编号') && has('原工单编号')

  if (dataSourceType === 'post_use_rating') {
    if (postUseRatingSubType === 'satisfaction_callback') {
      return isCallbackHeaders ? SATISFACTION_CALLBACK_PRESET : null
    }
    if (postUseRatingSubType === 'standalone' && (has('评价内容') || has('评分'))) {
      return POST_USE_RATING_PRESET
    }
    if (isCallbackHeaders) return SATISFACTION_CALLBACK_PRESET
    if (has('评价内容') || has('评分')) return POST_USE_RATING_PRESET
    return null
  }

  if (isCallbackHeaders) {
    return SATISFACTION_CALLBACK_PRESET
  }

  if (dataSourceType === 'consultation_ticket') {
    if (has('处理意见') || hasPrimaryTicketIdHeader(headers)) {
      return CONSULTATION_TICKET_PRESET
    }
    if (has('咨询内容') || has('答复内容')) {
      return {
        ...CONSULTATION_TICKET_PRESET,
        columnMap: {
          ...CONSULTATION_TICKET_PRESET.columnMap,
          rawText: has('咨询内容') ? '咨询内容' : '受理内容',
          handlingText: has('答复内容') ? '答复内容' : '处理意见',
        },
      }
    }
  }

  if (dataSourceType === 'complaint_ticket' && hasPrimaryTicketIdHeader(headers) && has('处理意见')) {
    return MOBILE_CLOUD_TICKET_PRESET
  }

  if (dataSourceType === 'user_survey' && (has('开放回答') || has('题目'))) {
    return USER_SURVEY_PRESET
  }

  if (dataSourceType === 'other' && (has('内容') || has('反馈'))) {
    return GENERIC_PRESET
  }

  if (!dataSourceType || dataSourceType === 'complaint_ticket') {
    if (hasPrimaryTicketIdHeader(headers) && has('处理意见')) return MOBILE_CLOUD_TICKET_PRESET
  }

  return null
}

/**
 * @param {import('../domain/enums.js').DataSourceType} dataSourceType
 * @param {import('../domain/postUseRatingImport.js').PostUseRatingImportSubType} [postUseRatingSubType]
 * @returns {ColumnPreset[]}
 */
export function getPresetsForImport(dataSourceType, postUseRatingSubType) {
  if (dataSourceType === 'post_use_rating') {
    if (postUseRatingSubType === 'satisfaction_callback') {
      return [SATISFACTION_CALLBACK_PRESET]
    }
    return [POST_USE_RATING_PRESET]
  }
  return getPresetsForSource(dataSourceType)
}

/**
 * @param {import('../domain/enums.js').DataSourceType} dataSourceType
 * @returns {ColumnPreset[]}
 */
export function getPresetsForSource(dataSourceType) {
  return COLUMN_PRESETS.filter(
    (p) => !p.dataSourceTypes || p.dataSourceTypes.includes(dataSourceType),
  )
}
