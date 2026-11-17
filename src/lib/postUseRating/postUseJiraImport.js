import * as XLSX from 'xlsx'
import { isPostUseJiraStatus, normalizePostUseJiraStatus } from '../../domain/postUseJira.js'
import { ACTION_ITEM_CONTENT_MAX_LENGTH, ACTION_ITEM_DETAIL_MAX_LENGTH } from '../../domain/actionItem.js'
import { ACTION_SCHEDULE_MAX_LENGTH } from '../../domain/actionSchedule.js'
import {
  callbackNonTenItemKey,
  questionnaireCallbackItemKey,
} from './callbackRecommendations.js'

// 与 postUseJiraExport.js 的导出列保持一致；额外列可存在，但缺列不能静默丢数据。
export const POST_USE_JIRA_IMPORT_HEADERS = [
  '数据月份', '客户名称', '客户编码', '登录账号名称', '产品名称', '客户反馈',
  '建议回访原因', '相应投诉工单', '经办人', '状态', '回溯结果',
  '确立举措', '举措详情', '排期',
]

const HEADER_FIELDS = [
  'importMonth', 'customerName', 'customerCode', 'loginAccountName', 'productName',
  'customerFeedback', 'recommendedReason', 'originalTicketId', 'assigneeName',
  'status', 'progress', 'actionContent', 'actionDetail', 'actionSchedule',
]

const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/
const STATUS_INPUTS = new Set(['待处理', '处理中', '已处理', '进行中', '已完成'])

const cellText = (value) => String(value ?? '').trim()

function numberedParts(value) {
  const text = cellText(value)
  const matches = [...text.matchAll(/^(\d+)\. /gm)]
  if (matches.length < 2 || matches[0].index !== 0) return null
  if (matches.some((match, index) => Number(match[1]) !== index + 1)) return null
  return matches.map((match, index) =>
    text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length).trim(),
  )
}

function parseActions(content, detail, schedule) {
  const rawContent = cellText(content)
  const rawDetail = cellText(detail)
  const rawSchedule = cellText(schedule)
  if (!rawContent) {
    if (rawDetail || rawSchedule) throw new Error('确立举措为空，但举措详情或排期有内容')
    return []
  }

  const contents = numberedParts(rawContent)
  if (!contents) return [{ content: rawContent, detail: rawDetail, scheduleAt: rawSchedule }]

  const aligned = (value, label) => {
    if (!value) return contents.map(() => '')
    const parts = numberedParts(value)
    if (!parts || parts.length !== contents.length) throw new Error(`${label}与确立举措的编号未对齐`)
    return parts.map((part) => part === '—' ? '' : part)
  }
  const details = aligned(rawDetail, '举措详情')
  const schedules = aligned(rawSchedule, '排期')
  return contents.map((item, index) => ({
    content: item === '—' ? '' : item,
    detail: details[index],
    scheduleAt: schedules[index],
  }))
}

/** 与清单生产方共用 key 生成逻辑，避免同客户同产品跨月串扰。 */
export function postUseJiraImportItemKey(item) {
  if (item.originalTicketId) return callbackNonTenItemKey({ originalTicketId: item.originalTicketId })
  return questionnaireCallbackItemKey({
    customerCode: item.customerCode,
    customerName: item.customerName,
    productName: item.productName,
    importMonths: item.importMonth.split('、'),
  })
}

/**
 * 同时用于浏览器预览和服务端入库前校验。所有行有误时阻止整批写入。
 * @param {Record<string, unknown>[]} rawItems
 */
export function validatePostUseJiraImportItems(rawItems) {
  const items = []
  const errors = []
  const seen = new Set()
  for (const [index, raw] of rawItems.entries()) {
    const suppliedRow = Number(raw?.rowNumber)
    const row = Number.isSafeInteger(suppliedRow) && suppliedRow > 0 ? suppliedRow : index + 2
    try {
      const item = Object.fromEntries(HEADER_FIELDS.map((field) => [field, cellText(raw[field])]))
      const months = item.importMonth.split(/[、,，;；|]/).map((month) => month.trim()).filter(Boolean)
      if (!months.length || months.some((month) => !MONTH_RE.test(month))) throw new Error('数据月份须为 YYYY-MM，可用顿号分隔多个月份')
      item.importMonth = [...new Set(months)].join('、')
      if (!item.customerName && !item.customerCode) throw new Error('客户名称和客户编码不能同时为空')
      if (!item.productName) throw new Error('产品名称不能为空')
      if (!STATUS_INPUTS.has(item.status)) throw new Error('状态须为待处理、处理中或已处理')
      item.status = normalizePostUseJiraStatus(item.status)
      if (!isPostUseJiraStatus(item.status)) throw new Error('状态无效')
      if (item.status === '已处理' && !item.progress) throw new Error('已处理记录须填写回溯结果')
      if (raw.actions != null && !Array.isArray(raw.actions)) throw new Error('确立举措格式无效')
      const actions = Array.isArray(raw.actions)
        ? raw.actions.map((action) => ({
            content: cellText(action?.content),
            detail: cellText(action?.detail),
            scheduleAt: cellText(action?.scheduleAt),
          }))
        : parseActions(item.actionContent, item.actionDetail, item.actionSchedule)
      if (actions.some((action) => !action.content)) throw new Error('确立举措的编号项不能为空')
      if (actions.some((action) => action.content.length > ACTION_ITEM_CONTENT_MAX_LENGTH)) {
        throw new Error(`确立举措不能超过 ${ACTION_ITEM_CONTENT_MAX_LENGTH} 字`)
      }
      if (actions.some((action) => action.detail.length > ACTION_ITEM_DETAIL_MAX_LENGTH)) {
        throw new Error(`举措详情不能超过 ${ACTION_ITEM_DETAIL_MAX_LENGTH} 字`)
      }
      if (actions.some((action) => action.scheduleAt.length > ACTION_SCHEDULE_MAX_LENGTH)) {
        throw new Error(`排期不能超过 ${ACTION_SCHEDULE_MAX_LENGTH} 字`)
      }
      const normalized = {
        rowNumber: row,
        importMonth: item.importMonth,
        customerName: item.customerName,
        customerCode: item.customerCode,
        loginAccountName: item.loginAccountName,
        productName: item.productName,
        customerFeedback: item.customerFeedback,
        recommendedReason: item.recommendedReason,
        originalTicketId: item.originalTicketId,
        assigneeName: item.assigneeName,
        status: item.status,
        progress: item.progress,
        actions,
      }
      const key = postUseJiraImportItemKey(normalized)
      if (seen.has(key)) throw new Error('与文件中另一行的月份、客户、产品或投诉工单重复')
      seen.add(key)
      items.push(normalized)
    } catch (error) {
      errors.push({ row, message: error instanceof Error ? error.message : '行内容无效' })
    }
  }
  return { items, errors }
}

/** @param {ArrayBuffer} buffer */
export function parsePostUseJiraImportWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets['产品部溯源'] || workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return { items: [], errors: [{ row: 0, message: '文件中没有工作表' }] }
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
  const headers = (grid[0] || []).map(cellText)
  const missing = POST_USE_JIRA_IMPORT_HEADERS.filter((header) => !headers.includes(header))
  if (missing.length) return { items: [], errors: [{ row: 1, message: `缺少表头：${missing.join('、')}` }] }
  const duplicates = POST_USE_JIRA_IMPORT_HEADERS.filter((header) => headers.filter((value) => value === header).length > 1)
  if (duplicates.length) return { items: [], errors: [{ row: 1, message: `重复表头：${duplicates.join('、')}` }] }
  const rawItems = grid.slice(1).flatMap((values, index) => {
    if (!values.some((value) => cellText(value))) return []
    return [Object.fromEntries([
      ['rowNumber', index + 2],
      ...POST_USE_JIRA_IMPORT_HEADERS.map((header, fieldIndex) => [HEADER_FIELDS[fieldIndex], values[headers.indexOf(header)]]),
    ])]
  })
  if (rawItems.length > 2000) {
    return { items: [], errors: [{ row: 0, message: '单次最多导入 2000 条记录' }] }
  }
  return validatePostUseJiraImportItems(rawItems)
}
