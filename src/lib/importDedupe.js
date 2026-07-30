import { buildGlobalTicketDedupeKey } from '../domain/records.js'
import { normalizeTicketId } from './desensitize.js'

/**
 * 由服务端返回的已有工单号构建全局去重键集合。
 * 再次 normalize 以保证与打标时 processRow 的规范化一致。
 * @param {string[]} ticketIds
 * @param {string} dataSourceType
 * @returns {Set<string>}
 */
export function buildExistingTicketKeySet(ticketIds, dataSourceType) {
  /** @type {Set<string>} */
  const set = new Set()
  for (const raw of ticketIds || []) {
    const key = buildGlobalTicketDedupeKey({
      dataSourceType,
      ticketId: normalizeTicketId(raw) || '',
    })
    if (key) set.add(key)
  }
  return set
}

/**
 * 打标前置全局去重：按"数据源类型+工单号"跳过与系统已有记录重复的行；
 * 批次内行间按同键去重（保留首行）；空工单号行一律放行。
 * @param {Object[]} rows
 * @param {Object} options
 * @param {string} options.dataSourceType
 * @param {Set<string>} [options.existingKeys] buildExistingTicketKeySet 的产物
 * @returns {{ uniqueRows: Object[]; skippedCount: number }}
 */
export function filterDuplicateImportRows(rows, { dataSourceType, existingKeys } = {}) {
  const seen = new Set(existingKeys || [])
  /** @type {Object[]} */
  const uniqueRows = []
  let skippedCount = 0
  for (const row of rows || []) {
    const key = buildGlobalTicketDedupeKey({
      dataSourceType,
      ticketId: normalizeTicketId(row?.ticketId) || '',
    })
    if (key && seen.has(key)) {
      skippedCount += 1
      continue
    }
    if (key) seen.add(key)
    uniqueRows.push(row)
  }
  return { uniqueRows, skippedCount }
}
