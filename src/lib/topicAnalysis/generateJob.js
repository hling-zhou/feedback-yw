import { topicRequestErrorMessage } from './customTopic.js'
import { generateTopicReportBrief } from './generateReport.js'
import { loadRecordsForTopicPeriod, periodFromSnapshot } from './period.js'
import { filterRecordsForTopicRecommend } from './recommendScope.js'
import { saveTopicReport } from './store.js'

/** @type {Set<string>} */
const inflightIds = new Set()

export function isTopicReportJobRunning(reportId) {
  return inflightIds.has(String(reportId || ''))
}

/**
 * @param {object} report
 * @param {object} [patch]
 */
export function withReportStatus(report, patch = {}) {
  return {
    ...report,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 后台生成简报并回写报告。同一 id 不会并行跑两次。
 * @param {{
 *   adapter: object,
 *   settings?: object,
 *   report: object,
 *   records?: object[],
 * }} input
 */
export async function runTopicReportJob(input) {
  const report = input?.report
  const id = String(report?.id || '')
  if (!id || !input.adapter) return report
  if (inflightIds.has(id)) return report
  inflightIds.add(id)
  try {
    const period = periodFromSnapshot(report.period)
    const loaded = Array.isArray(input.records) && input.records.length
      ? input.records
      : await loadRecordsForTopicPeriod(input.adapter, period)
    const records = report.origin === 'custom'
      ? loaded
      : filterRecordsForTopicRecommend(loaded)
    const brief = await generateTopicReportBrief({
      adapter: input.adapter,
      settings: input.settings,
      topic: report.topic,
      records,
      period,
      periodLabel: report.period?.label || period.label,
      supplements: report.supplements || report.brief?.supplements || [],
    })
    const next = withReportStatus(report, {
      brief,
      status: 'ready',
      error: '',
    })
    await saveTopicReport(input.adapter, next)
    return next
  } catch (err) {
    const next = withReportStatus(report, {
      status: 'failed',
      error: topicRequestErrorMessage(err, '生成报告失败'),
    })
    try {
      await saveTopicReport(input.adapter, next)
    } catch {
      // keep failed object for caller
    }
    return next
  } finally {
    inflightIds.delete(id)
  }
}
