import { pdf } from '@react-pdf/renderer'
import { yieldForHeavyTask, yieldToMain, yieldUntilIdle } from '../yieldToMain.js'
import { InsightReportDocument } from './InsightReportPdf.jsx'
import { buildReportModel } from './buildReportModel.js'
import { ensurePdfFontsReady } from './registerPdfFonts.js'

/**
 * @param {Parameters<typeof buildReportModel>[0] & {
 *   chartImages?: import('./captureChartImages.js').ChartImage[];
 * }} params
 * @param {string} [filename]
 */
export async function downloadInsightPdf(params, filename) {
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
  const safeName =
    filename ||
    `insight-report-${params.scope}-${params.period?.label || 'period'}.pdf`.replace(
      /[^\w\u4e00-\u9fa5.-]+/g,
      '_',
    )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
