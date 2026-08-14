import { MAX_SAVED_TOPIC_RUNS, META_KEY_TOPIC_ANALYSIS_REPORTS, META_KEY_TOPIC_ANALYSIS_RUNS } from './constants.js'
import { randomId } from '../randomId.js'
import { preserveTopicReportActors } from './reportActors.js'

function asReports(raw) {
  if (Array.isArray(raw?.reports)) return raw.reports
  if (Array.isArray(raw?.runs)) {
    return raw.runs.map((run) => ({
      id: run.id || randomId(),
      title: run.brief?.topic?.title || '未命名专题',
      type: run.brief?.topic?.type || 'common_issue',
      origin: 'custom',
      period: {
        label: run.periodLabel || '',
        fromMonth: '',
        toMonth: '',
      },
      topic: run.brief?.topic || {},
      brief: run.brief || null,
      supplements: run.brief?.supplements || [],
      sourceRecommendationId: '',
      createdAt: run.savedAt || new Date().toISOString(),
      updatedAt: run.savedAt || new Date().toISOString(),
    }))
  }
  return []
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown> }} adapter
 */
export async function loadTopicReports(adapter) {
  const raw = await adapter.getMeta(META_KEY_TOPIC_ANALYSIS_REPORTS)
  if (raw && typeof raw === 'object' && Array.isArray(raw.reports)) return raw.reports
  return asReports(await adapter.getMeta(META_KEY_TOPIC_ANALYSIS_RUNS))
}

/**
 * @param {object[]} reports
 * @param {string} [recommendationId]
 */
export function findReportByRecommendationId(reports, recommendationId) {
  const id = String(recommendationId || '').trim()
  if (!id) return null
  return (reports || []).find((item) => item.sourceRecommendationId === id) || null
}

function reportTime(report) {
  return String(report?.updatedAt || report?.createdAt || '')
}

/**
 * 合并服务端列表与本地列表：同 id 取更新时间较新的；本地刚写入、服务端尚未读到的条目保留。
 * @param {object[]} serverList
 * @param {object[]} localList
 */
export function mergeTopicReports(serverList, localList) {
  const byId = new Map()
  for (const item of localList || []) {
    if (item?.id) byId.set(item.id, item)
  }
  for (const item of serverList || []) {
    if (!item?.id) continue
    const prev = byId.get(item.id)
    if (!prev || reportTime(item) >= reportTime(prev)) byId.set(item.id, item)
  }
  return [...byId.values()].sort((a, b) => reportTime(b).localeCompare(reportTime(a)))
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>, putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {object} report
 */
export async function saveTopicReport(adapter, report) {
  const prev = await loadTopicReports(adapter)
  const existing = prev.find((item) => item.id === report.id)
  const toSave = preserveTopicReportActors(report, existing)
  const next = [toSave, ...prev.filter((item) => item.id !== toSave.id)].slice(0, MAX_SAVED_TOPIC_RUNS)
  await adapter.putMeta(META_KEY_TOPIC_ANALYSIS_REPORTS, {
    version: 1,
    updatedAt: new Date().toISOString(),
    reports: next,
  })
  const saved = await loadTopicReports(adapter)
  if (!saved.some((item) => item.id === toSave.id)) {
    throw new Error('专题报告未能写入存储，请重试')
  }
  return saved
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown> }} adapter
 * @param {string} id
 */
export async function getTopicReport(adapter, id) {
  const reports = await loadTopicReports(adapter)
  return reports.find((item) => item.id === id) || null
}

/**
 * @param {Partial<object>} fields
 */
export function createTopicReport(fields) {
  const now = new Date().toISOString()
  return {
    id: fields.id || randomId(),
    title: fields.title || '未命名专题',
    type: fields.type || 'common_issue',
    origin: fields.origin || 'custom',
    period: fields.period || { label: '', fromMonth: '', toMonth: '' },
    topic: fields.topic || {},
    brief: fields.brief || null,
    supplements: fields.supplements || [],
    sourceRecommendationId: fields.sourceRecommendationId || '',
    status: fields.status || 'ready',
    error: fields.error || '',
    createdBy: fields.createdBy || null,
    updatedBy: fields.updatedBy || null,
    createdAt: fields.createdAt || now,
    updatedAt: now,
  }
}
