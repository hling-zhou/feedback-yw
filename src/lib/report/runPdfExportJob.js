import {
  captureChartsForScope,
  waitForChartsReady,
  waitForWorkbenchCharts,
} from './captureChartImages.js'
import { compressChartImagesForPdf } from './compressChartImages.js'
import { generateInsightPdfBlob, triggerPdfDownload } from './generateInsightPdf.jsx'
import { yieldForHeavyTask } from '../yieldToMain.js'

/** @typedef {import('../../domain/pdfExportJob.js').PdfExportJob} PdfExportJob */

/**
 * @typedef {Object} PdfExportProgressUpdate
 * @property {import('../../domain/pdfExportJob.js').PdfExportJobStatus} [status]
 * @property {string} message
 * @property {number} [chartCount]
 */

/**
 * @param {PdfExportJob} job
 * @param {Object} ctx
 * @param {() => Promise<HTMLElement>} ctx.getCaptureRoot
 * @param {(update: PdfExportProgressUpdate) => void} ctx.onProgress
 */
export async function runPdfExportJob(job, { getCaptureRoot, onProgress }) {
  const { payload } = job

  onProgress({ status: 'preparing', message: '准备导出环境…' })
  await yieldForHeavyTask()

  const root = await getCaptureRoot()

  onProgress({ status: 'capturing', message: '等待图表渲染…' })
  await waitForChartsReady(500)
  await waitForWorkbenchCharts(job.scope, root, { renderMs: 1000 })
  nudgeChartLayout()
  await waitForChartsReady(300)

  let lastCaptureMessage = '正在截取图表…'
  let chartImages = await captureChartsForScope(job.scope, root, ({ index, total, title }) => {
    lastCaptureMessage =
      total > 0 ? `正在截取图表（${index + 1}/${total}）· ${title}` : '正在截取图表…'
    onProgress({ status: 'capturing', message: lastCaptureMessage })
  })

  onProgress({ status: 'capturing', message: '正在优化图表…' })
  chartImages = await compressChartImagesForPdf(chartImages)

  onProgress({ status: 'generating', message: '正在生成 PDF 文件…' })
  await yieldForHeavyTask()

  const { blob, filename } = await generateInsightPdfBlob({
    scope: payload.scope,
    period: payload.period,
    overview: payload.overview ?? null,
    sourceSnapshot: payload.sourceSnapshot ?? null,
    exportedBy: payload.exportedBy || '本地用户',
    chartImages,
    wanTouRows: payload.wanTouRows || [],
    feedbacks: payload.feedbacks || [],
  })

  triggerPdfDownload(blob, filename)

  const chartNote = chartImages.length
    ? `含 ${chartImages.length} 张图表`
    : '未捕获图表，已导出文字摘要'

  onProgress({
    status: 'done',
    message: `PDF 已生成（${chartNote}）`,
    chartCount: chartImages.length,
  })
}
