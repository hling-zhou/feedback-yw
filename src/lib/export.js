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
