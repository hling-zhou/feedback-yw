import Papa from 'papaparse'

/**
 * @param {import('../domain/analysisRun.js').AnalysisRunFailure[]} failures
 */
export function exportFailuresToCsv(failures) {
  const rows = failures.map((f) => ({
    行号: f.rowIndex != null ? f.rowIndex + 1 : '',
    记录ID: f.recordId || '',
    错误码: f.code,
    说明: f.message,
  }))
  return Papa.unparse(rows)
}

/**
 * 回访导入未匹配清单 CSV（人工核对：哪条回访工单没找到原单/被占用）。
 * @param {{ rowIndex?: number, originalTicketId?: string, followUpTicketId?: string, reason?: string }[]} unmatched
 * @param {string} [filename]
 */
export function downloadUnmatchedFollowUpCsv(unmatched, filename = 'follow-up-unmatched.csv') {
  if (!unmatched?.length) return
  const rows = unmatched.map((u) => ({
    行号: u.rowIndex != null ? u.rowIndex + 1 : '',
    原工单号: u.originalTicketId || '',
    回访工单号: u.followUpTicketId || '',
    未匹配原因: u.reason || '',
  }))
  const csv = Papa.unparse(rows)
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * @param {import('../domain/analysisRun.js').AnalysisRunFailure[]} failures
 * @param {string} [filename]
 */
export function downloadFailuresCsv(failures, filename = 'import-failures.csv') {
  if (!failures?.length) return
  const csv = exportFailuresToCsv(failures)
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
