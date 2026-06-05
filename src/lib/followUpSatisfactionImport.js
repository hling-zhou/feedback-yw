/**
 * 满意度回访记录导入：解析行、匹配投诉/咨询工单、批量 patch。
 * @see docs/DESIGN-用后即评-满意度回访.md §4
 */

import { normalizeTicketId } from './desensitize.js'
import { recordMatchesPeriod } from '../domain/insightPeriod.js'
import {
  SATISFACTION_CALLBACK_REPORT_COLUMNS,
  applyFollowUpSatisfactionPatch,
  buildFollowUpSatisfactionFromReportRow,
} from '../domain/followUpSatisfaction.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/**
 * @typedef {Object} FollowUpImportUnmatchedRow
 * @property {number} rowIndex - 1-based data row
 * @property {string} [originalTicketId]
 * @property {string} [followUpTicketId]
 * @property {string} reason
 */

/**
 * @typedef {Object} FollowUpImportWarning
 * @property {number} rowIndex
 * @property {string} message
 */

/**
 * @typedef {Object} FollowUpImportResult
 * @property {number} appliedRowCount
 * @property {number} skippedNotSuccessful
 * @property {number} skippedInvalidScore
 * @property {number} updatedRecordCount
 * @property {number} outOfPeriodCount
 * @property {number} overwrittenCount
 * @property {number} idempotentUpdateCount
 * @property {FollowUpImportUnmatchedRow[]} unmatched
 * @property {FollowUpImportWarning[]} warnings
 * @property {FeedbackRecord[]} updatedRecords
 */

/**
 * @param {FeedbackRecord[]} records
 */
export function buildTicketRecordIndex(records) {
  /** @type {Map<string, FeedbackRecord>} */
  const byTicketId = new Map()

  for (const record of records) {
    const ticketId = normalizeTicketId(record.ticketId)
    if (!ticketId) continue
    const existing = byTicketId.get(ticketId)
    if (!existing) {
      byTicketId.set(ticketId, record)
      continue
    }
    if (
      existing.dataSourceType === 'consultation_ticket' &&
      record.dataSourceType === 'complaint_ticket'
    ) {
      byTicketId.set(ticketId, record)
    }
  }

  return { byTicketId }
}

/**
 * @param {Record<string, string>[]} rows
 * @param {FeedbackRecord[]} records
 * @param {{
 *   importMonth: string
 *   importBatchId?: string
 *   importedAt?: string
 *   period?: import('../domain/insightPeriod.js').InsightPeriod | null
 *   columnMap?: Partial<typeof SATISFACTION_CALLBACK_REPORT_COLUMNS>
 * }} options
 * @returns {FollowUpImportResult}
 */
export function processFollowUpSatisfactionImportRows(rows, records, options) {
  const columnMap = { ...SATISFACTION_CALLBACK_REPORT_COLUMNS, ...options.columnMap }
  const importedAt = options.importedAt || new Date().toISOString()
  const { byTicketId } = buildTicketRecordIndex(records)

  /** @type {Map<string, FeedbackRecord>} */
  const updates = new Map()
  /** @type {FollowUpImportUnmatchedRow[]} */
  const unmatched = []
  /** @type {FollowUpImportWarning[]} */
  const warnings = []

  let appliedRowCount = 0
  let skippedNotSuccessful = 0
  let skippedInvalidScore = 0
  let outOfPeriodCount = 0
  let overwrittenCount = 0
  let idempotentUpdateCount = 0

  /** @type {Map<string, string>} followUpTicketId → normalized originalTicketId */
  const followUpTicketIndex = new Map()

  rows.forEach((row, index) => {
    const rowIndex = index + 1
    const followUp = buildFollowUpSatisfactionFromReportRow(row, {
      importMonth: options.importMonth,
      importBatchId: options.importBatchId,
      importedAt,
      columnMap,
    })

    if (!followUp?.followUpSuccessful) {
      skippedNotSuccessful += 1
      return
    }

    if (followUp.score == null) {
      skippedInvalidScore += 1
      warnings.push({
        rowIndex,
        message: '回访成功但评分无效或缺失，已跳过',
      })
      return
    }

    const originalTicketId = normalizeTicketId(row[columnMap.originalTicketId])
    if (!originalTicketId) {
      unmatched.push({
        rowIndex,
        followUpTicketId: followUp.followUpTicketId,
        reason: '缺少原工单号',
      })
      return
    }

    const followUpTicketId = followUp.followUpTicketId
    const indexedOriginal = followUpTicketIndex.get(followUpTicketId)
    if (indexedOriginal && indexedOriginal !== originalTicketId) {
      unmatched.push({
        rowIndex,
        originalTicketId,
        followUpTicketId,
        reason: '回访工单号在本批次已绑定其他原工单',
      })
      return
    }

    const existingOwner = records.find(
      (rec) =>
        rec.followUpSatisfaction?.followUpTicketId === followUpTicketId &&
        normalizeTicketId(rec.ticketId) !== originalTicketId,
    )
    if (existingOwner) {
      unmatched.push({
        rowIndex,
        originalTicketId,
        followUpTicketId,
        reason: `回访工单号已存在于工单 ${existingOwner.ticketId || existingOwner.id}`,
      })
      return
    }

    const matched = byTicketId.get(originalTicketId)
    if (!matched) {
      unmatched.push({
        rowIndex,
        originalTicketId,
        followUpTicketId: followUp.followUpTicketId,
        reason: '未找到投诉/咨询工单',
      })
      return
    }

    const productCol = String(row[columnMap.productSpec] ?? '').trim()
    const recordProduct = String(matched.product || matched.productSpec || '').trim()
    if (productCol && recordProduct && productCol !== recordProduct) {
      const same =
        productCol.includes(recordProduct) || recordProduct.includes(productCol)
      if (!same) {
        warnings.push({
          rowIndex,
          message: `产品不一致：报表「${productCol}」≠ 工单「${recordProduct}」`,
        })
      }
    }

    const baseRecord = updates.get(matched.id) || matched
    const previousFollowUpId = baseRecord.followUpSatisfaction?.followUpTicketId?.trim()
    if (previousFollowUpId && previousFollowUpId !== followUp.followUpTicketId) {
      overwrittenCount += 1
    } else if (previousFollowUpId === followUp.followUpTicketId) {
      idempotentUpdateCount += 1
    }

    const outOfPeriod = Boolean(options.period && !recordMatchesPeriod(baseRecord, options.period))
    const patched = applyFollowUpSatisfactionPatch(baseRecord, followUp, {
      outOfPeriodWarning: outOfPeriod || undefined,
    })

    if (outOfPeriod) outOfPeriodCount += 1
    updates.set(matched.id, patched)
    followUpTicketIndex.set(followUpTicketId, originalTicketId)
    appliedRowCount += 1
  })

  return {
    appliedRowCount,
    skippedNotSuccessful,
    skippedInvalidScore,
    updatedRecordCount: updates.size,
    outOfPeriodCount,
    overwrittenCount,
    idempotentUpdateCount,
    unmatched,
    warnings,
    updatedRecords: [...updates.values()],
  }
}

/**
 * @param {FollowUpImportResult} result
 */
export function summarizeFollowUpImportResult(result) {
  return {
    appliedRowCount: result.appliedRowCount,
    skippedNotSuccessful: result.skippedNotSuccessful,
    skippedInvalidScore: result.skippedInvalidScore,
    updatedRecordCount: result.updatedRecordCount,
    outOfPeriodCount: result.outOfPeriodCount,
    overwrittenCount: result.overwrittenCount,
    idempotentUpdateCount: result.idempotentUpdateCount,
    unmatched: result.unmatched,
    warnings: result.warnings,
  }
}

/**
 * @param {FollowUpImportUnmatchedRow[]} unmatched
 * @param {string} [filename]
 */
export function downloadUnmatchedFollowUpCsv(unmatched, filename = 'follow-up-unmatched.csv') {
  if (!unmatched?.length) return
  const rows = unmatched.map((item) => ({
    行号: item.rowIndex,
    原工单号: item.originalTicketId || '',
    回访工单号: item.followUpTicketId || '',
    原因: item.reason,
  }))
  const header = '行号,原工单号,回访工单号,原因\n'
  const body = rows
    .map((row) =>
      [row.行号, row.原工单号, row.回访工单号, row.原因]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    )
    .join('\n')
  const blob = new Blob(['\ufeff' + header + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
