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
 * 导入批次内按「数据源类型+工单号」去重。
 * - 同键保留**最后一行**（同文件内以较新行为准）
 * - 空工单号一律放行
 * - 不再按库内已有工单号跳过（同号再导入改为覆盖合并）
 *
 * @param {Object[]} rows
 * @param {Object} options
 * @param {string} options.dataSourceType
 * @returns {{ uniqueRows: Object[]; skippedCount: number }}
 */
export function filterDuplicateImportRows(rows, { dataSourceType } = {}) {
  /** @type {Map<string, Object>} */
  const byKey = new Map()
  /** @type {Object[]} */
  const emptyTicketRows = []
  let replacedCount = 0

  for (const row of rows || []) {
    const key = buildGlobalTicketDedupeKey({
      dataSourceType,
      ticketId: normalizeTicketId(row?.ticketId) || '',
    })
    if (!key) {
      emptyTicketRows.push(row)
      continue
    }
    if (byKey.has(key)) replacedCount += 1
    byKey.set(key, row)
  }

  return {
    uniqueRows: [...byKey.values(), ...emptyTicketRows],
    skippedCount: replacedCount,
  }
}
