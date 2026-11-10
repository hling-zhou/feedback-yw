import * as XLSX from 'xlsx'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import {
  MOBILE_CLOUD_TICKET_PRESET,
  CONSULTATION_TICKET_PRESET,
  USER_SURVEY_PRESET,
  GENERIC_PRESET,
  POST_USE_CUSTOMER_VISIT_PRESET,
} from './columnPresets.js'
import { POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT } from '../domain/postUseRatingImport.js'
import { INTERNAL_CONCLUSIONS } from './postUseRating/customerVisitImport.js'

/**
 * 数据导入「上传文件」步的空白模板下载（列头 sheet + 填写说明 sheet）。
 * 列名必须与 columnPresets.js 各预设完全一致——preset 自动识别按表头精确匹配
 * （has('处理意见') / has('数据月份') 等），加「*（必填）」等标记会破坏自动识别与
 * 自动列映射；必填/选填差异写进「填写说明」sheet。
 *
 * 模板不含「短信+官网双文件」：该方式消费系统原始导出件（按「调研结果状态」/
 * 「产品名」/「回访工单编号」识别），无人工填写模板概念。
 */

/** 列头 sheet 名 */
const TEMPLATE_HEADER_SHEET_NAME = '数据填写'

/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/**
 * @typedef {Object} ImportTemplateSpec
 * @property {string} id
 * @property {string} filenameLabel 文件名中的来源标识
 * @property {string[]} headers 列头（与 preset columnMap 值一致）
 * @property {string[][]} instructions 填写说明行（aoa：每行一列）
 * @property {DataSourceType} dataSourceType
 */

const COMPLAINT_INSTRUCTIONS = [
  ['填写说明'],
  ['必填列：工单展示流水号（或工单流水号）、处理意见；建议同时填写受理内容。'],
  ['表头列名需与模板保持一致（含空格与全角括号），否则不会被自动识别与映射。'],
  ['工单展示流水号：系统按「工单展示流水号」优先识别表头（无此列时用「工单流水号」）。'],
  ['处理意见：四维打标（请求场景、问题类型、用户旅程、用户情绪）与客户请求/痛点抽取的主要语料。'],
  ['受理内容：客户侧问题描述，用于抽取客户原话，可与「追加信息」列拼接。'],
  ['具体投诉产品：系统据此匹配目标产品范围与规格，不在范围内的行会被跳过。'],
  ['投诉原因 一级/二级/三级（终判）：仅投诉工单；写入终判字段与原始列快照，不参与问题类型自动打标。'],
  ['仅分析产品中心已启用的产品；未配置时请在「产品配置中心」先维护。'],
  ['同工单号重复导入会覆盖库内导入表字段与自动打标结果；人工维护内容（复核、举措、待办、备注、回访满意度）保留。'],
  ['单文件 ≤30MB、≤10000 行；最多 5 个结构相同的文件合并导入。'],
  ['加密文件可把密码写在文件名中：名称#密码.xlsx。'],
]

const CONSULTATION_INSTRUCTIONS = [
  ['填写说明'],
  ['必填列：工单展示流水号（或工单流水号）、处理意见；建议同时填写受理内容。'],
  ['表头列名需与模板保持一致（含空格与全角括号），否则不会被自动识别与映射。'],
  ['处理意见：四维打标与客户请求/需求痛点/优化建议分析的主要语料；也可用「答复内容」列替代。'],
  ['受理内容：客户侧问题描述，用于抽取客户原话；也可用「咨询内容」列替代。'],
  ['具体投诉产品：系统据此匹配目标产品范围与规格，不在范围内的行会被跳过。'],
  ['单文件 ≤30MB、≤10000 行；最多 5 个结构相同的文件合并导入。'],
  ['加密文件可把密码写在文件名中：名称#密码.xlsx。'],
]

const CUSTOMER_VISIT_INSTRUCTIONS = [
  ['填写说明'],
  ['模板列头与系统识别口径一致；表头需包含：数据月份、客户名称、客户编码、产品名称、回访结果。'],
  ['必填（四项内容）：数据月份、产品名称、客户名称或客户编码、回访结果。'],
  // 2026-11-10 用户拍板：模板去掉 集团名称、评分来源 列
  ['可选列：登录账号名称、相应投诉工单、内部评估、经办人、备注、客户反馈（允许为空）。'],
  [`内部评估可填：${INTERNAL_CONCLUSIONS.join('；')}。`],
  ['数据月份格式：YYYY-MM（如 2026-10）。'],
  ['相应投诉工单：填写原投诉工单号，可挂接到对应工单；留空仅写入回访元数据。'],
  ['客户反馈：客户在回访中的反馈内容原话，可选列。'],
  ['写入 visit_records 并软匹配挂到短信/控制台用后即评明细；最多 5 个结构相同的文件合并导入。'],
]

const USER_SURVEY_INSTRUCTIONS = [
  ['填写说明'],
  ['必填列：开放回答（有作答内容才会导入）。'],
  ['表头列名需与模板保持一致，否则不会被自动识别与映射。'],
  ['提交时间：建议填写；留空时导入界面选择的数据月份为准。'],
  ['产品：用于匹配目标产品范围，不在范围内的行会被跳过。'],
  ['单文件 ≤30MB、≤10000 行；最多 5 个结构相同的文件合并导入。'],
]

const GENERIC_INSTRUCTIONS = [
  ['填写说明'],
  ['必填列：内容（有文本内容才会导入）。'],
  ['表头列名需与模板保持一致，否则不会被自动识别与映射。'],
  ['时间：建议填写；留空时导入界面选择的数据月份为准。'],
  ['单文件 ≤30MB、≤10000 行；最多 5 个结构相同的文件合并导入。'],
]

/** 从 preset.columnMap 提取列头（保持定义顺序；数组候选取首选列名；同名列去重——如客服部回访的 visitFeedbackDetail 与 visitResult 共用「回访结果」列） */
function headersFromPreset(preset) {
  const seen = new Set()
  const headers = []
  for (const col of Object.values(preset.columnMap)) {
    const name = Array.isArray(col) ? col[0] : col
    if (seen.has(name)) continue
    seen.add(name)
    headers.push(name)
  }
  return headers
}

/** @type {ImportTemplateSpec[]} */
const TEMPLATE_SPECS = [
  {
    id: MOBILE_CLOUD_TICKET_PRESET.id,
    filenameLabel: '投诉工单',
    headers: headersFromPreset(MOBILE_CLOUD_TICKET_PRESET),
    instructions: COMPLAINT_INSTRUCTIONS,
    dataSourceType: 'complaint_ticket',
  },
  {
    id: CONSULTATION_TICKET_PRESET.id,
    filenameLabel: '咨询工单',
    headers: headersFromPreset(CONSULTATION_TICKET_PRESET),
    instructions: CONSULTATION_INSTRUCTIONS,
    dataSourceType: 'consultation_ticket',
  },
  {
    id: POST_USE_CUSTOMER_VISIT_PRESET.id,
    filenameLabel: '客服部回访',
    headers: headersFromPreset(POST_USE_CUSTOMER_VISIT_PRESET),
    instructions: CUSTOMER_VISIT_INSTRUCTIONS,
    dataSourceType: 'post_use_rating',
  },
  {
    id: USER_SURVEY_PRESET.id,
    filenameLabel: '用户调研',
    headers: headersFromPreset(USER_SURVEY_PRESET),
    instructions: USER_SURVEY_INSTRUCTIONS,
    dataSourceType: 'user_survey',
  },
  {
    id: GENERIC_PRESET.id,
    filenameLabel: '其他反馈',
    headers: headersFromPreset(GENERIC_PRESET),
    instructions: GENERIC_INSTRUCTIONS,
    dataSourceType: 'other',
  },
]

/**
 * 当前导入上下文是否有对应模板（channel_bundle / satisfaction_callback 无模板）
 * @param {DataSourceType} dataSourceType
 * @param {import('../domain/postUseRatingImport.js').PostUseRatingImportSubType} [postUseRatingSubType]
 */
export function hasImportDataTemplate(dataSourceType, postUseRatingSubType) {
  if (dataSourceType === 'post_use_rating') {
    return postUseRatingSubType === POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT
  }
  return ['complaint_ticket', 'consultation_ticket', 'user_survey', 'other'].includes(
    dataSourceType,
  )
}

/**
 * 构建当前来源的模板 xlsx 字节（列头 sheet + 填写说明 sheet）。
 * 纯函数、无 DOM 依赖，供守卫测试做真实产物校验。
 * @param {DataSourceType} dataSourceType
 * @param {import('../domain/postUseRatingImport.js').PostUseRatingImportSubType} [postUseRatingSubType]
 * @returns {{ buffer: Uint8Array; filename: string } | null} 无对应模板时 null
 */
export function buildImportDataTemplate(dataSourceType, postUseRatingSubType) {
  const spec = TEMPLATE_SPECS.find(
    (item) =>
      item.dataSourceType === dataSourceType &&
      (item.dataSourceType !== 'post_use_rating' ||
        postUseRatingSubType === POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT),
  )
  if (!spec) return null

  const wb = XLSX.utils.book_new()

  const emptyRow = Object.fromEntries(spec.headers.map((h) => [h, '']))
  const headerSheet = XLSX.utils.json_to_sheet([emptyRow], { header: spec.headers })
  XLSX.utils.book_append_sheet(wb, headerSheet, TEMPLATE_HEADER_SHEET_NAME)

  const guideSheet = XLSX.utils.aoa_to_sheet(spec.instructions)
  XLSX.utils.book_append_sheet(wb, guideSheet, '填写说明')

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return {
    /** @type {Uint8Array} */
    buffer: new Uint8Array(/** @type {Uint8Array} */ (buffer)),
    filename: `数据导入-${spec.filenameLabel}-模板-${new Date().toISOString().slice(0, 10)}.xlsx`,
  }
}

/**
 * 下载当前来源的空白导入模板（列头 sheet + 填写说明 sheet）
 * @param {DataSourceType} dataSourceType
 * @param {import('../domain/postUseRatingImport.js').PostUseRatingImportSubType} [postUseRatingSubType]
 * @returns {boolean} 是否下载了模板（无对应模板时 false）
 */
export function downloadImportDataTemplate(dataSourceType, postUseRatingSubType) {
  const product = buildImportDataTemplate(dataSourceType, postUseRatingSubType)
  if (!product) return false

  triggerDownload(
    new Blob([product.buffer.slice().buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    product.filename,
  )
  return true
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
