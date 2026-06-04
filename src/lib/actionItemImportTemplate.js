import * as XLSX from 'xlsx'
import { ACTION_ITEM_LIST_SHEET_NAME } from './actionItemExport.js'

/** 导入模板表头（必填项用 * 标记） */
export const ACTION_ITEM_IMPORT_TEMPLATE_HEADERS = [
  '产品名称（可选）',
  '问题（可选）',
  '问题类型（可选）',
  '来源（可选）',
  '举措*（必填）',
  '举措详情（可选）',
  '关联反馈（可选）',
  '需求工单（可选）',
  '排期时间（可选）',
  '状态（可选）',
]

const TEMPLATE_INSTRUCTIONS = [
  ['填写说明'],
  ['仅「举措*（必填）」为必填；其余列可留空。'],
  ['问题、问题类型、来源、关联反馈留空时，可在工单详情关联该举措后自动补齐。'],
  ['举措详情为补充说明，非必填；需求工单可填多个单号（逗号、分号或换行分隔）。'],
  ['首次提出时间在导入时记为导入当天，无需填写。'],
  ['来源可填：投诉工单、咨询工单、用后即评、用户调研、其他（多个用顿号分隔）。'],
  ['状态可填：待评估、进行中、已完成、挂起；留空则按排期推断。'],
]

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

/** 下载空白导入模板（含表头与填写说明） */
export function downloadActionItemImportTemplate() {
  const wb = XLSX.utils.book_new()

  const emptyRow = Object.fromEntries(ACTION_ITEM_IMPORT_TEMPLATE_HEADERS.map((h) => [h, '']))
  const listSheet = XLSX.utils.json_to_sheet([emptyRow], {
    header: ACTION_ITEM_IMPORT_TEMPLATE_HEADERS,
  })
  XLSX.utils.book_append_sheet(wb, listSheet, ACTION_ITEM_LIST_SHEET_NAME)

  const guideSheet = XLSX.utils.aoa_to_sheet(TEMPLATE_INSTRUCTIONS)
  XLSX.utils.book_append_sheet(wb, guideSheet, '填写说明')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  triggerDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `举措与进展-导入模板-${new Date().toISOString().slice(0, 10)}.xlsx`,
  )
}
