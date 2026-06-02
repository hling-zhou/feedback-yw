import { pdf } from '@react-pdf/renderer'
import { yieldForHeavyTask, yieldToMain, yieldUntilIdle } from '../yieldToMain.js'
import { InsightReportDocument } from './InsightReportPdf.jsx'
import { buildReportModel } from './buildReportModel.js'
import { ensurePdfFontsReady } from './registerPdfFonts.js'

/**
 * @param {Parameters<typeof buildReportModel>[0] & {
 *   chartImages?: import('./captureChartImages.js').ChartImage[];
 * }} params
 */
export function buildInsightPdfFilename(params) {
  const safeName = `insight-report-${params.scope}-${params.period?.label || 'period'}.pdf`.replace(
    /[^\w\u4e00-\u9fa5.-]+/g,
    '_',
  )
  return safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`
}

/**
 * @param {Parameters<typeof buildReportModel>[0] & {
 *   chartImages?: import('./captureChartImages.js').ChartImage[];
 * }} params
 * @returns {Promise<{ blob: Blob; filename: string }>}
 */
export async function generateInsightPdfBlob(params) {
  await ensurePdfFontsReady()

  const model = buildReportModel(params)
  if (params.chartImages?.length) {
    model.chartImages = params.chartImages
  }

  const doc = <InsightReportDocument model={model} />
  await yieldForHeavyTask()
  await yieldUntilIdle(150)
  const blob = await pdf(doc).toBlob()
  await yieldToMain(0)

  return { blob, filename: buildInsightPdfFilename(params) }
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
export function triggerPdfDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
