/**
 * 客服部回访 Excel 导入：解析、软匹配用后即评明细、双写 visit_records + customerVisit
 */
import { isPostUseRatingLibraryRecord } from '../../domain/postUseRatingImport.js'
import {
  loadVisitRecords,
  saveVisitRecords,
  upsertVisitRecord,
} from './visitRecords.js'

/** 客服部回访导入支持的 6 项内部结论 */
export const INTERNAL_CONCLUSIONS = [
  '无需优改（客户误操作/无实际不满/账户异常/极小概率场景）',
  '综合评估后暂不处理',
  '受限于移动云统一规则无法支持',
  '需求接纳（依赖集团排期）',
  '无需优化（其他产品问题）',
  '待客户反馈',
]

/** @type {Record<string, 'console' | 'sms' | 'callback'>} */
export const SCORE_SOURCE_TO_CHANNEL = {
  控制台评分: 'console',
  短信评分: 'sms',
  投诉回访: 'callback',
}

/**
 * @param {string | null | undefined} ratingText e.g. "1分*1"
 * @returns {number}
 */
export function parseRatingScoreFromText(ratingText) {
  const s = String(ratingText ?? '').trim()
  if (!s) return NaN
  const m = s.match(/(\d+(?:\.\d+)?)\s*分/)
  if (m) {
    const n = Number(m[1])
    return Number.isFinite(n) ? n : NaN
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

function hashVisitKey(parts) {
  const key = parts.map((item) => String(item ?? '').trim()).join('\0')
  let h = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `visit-${(h >>> 0).toString(16)}`
}

/**
 * 历史稳定 id：数据月份 + 产品 + 客户。仅用于对齐已入库的单条旧记录。
 * @param {string} visitMonth
 * @param {string} productName
 * @param {string} customerKey
 */
export function stableVisitRecordId(visitMonth, productName, customerKey) {
  return hashVisitKey([visitMonth, productName, customerKey])
}

/**
 * 同一客户、产品、月份的多行各自成条。内容与文件内出现次序都参与 id，
 * 再次导入同一份文件时更新原记录，不额外复制。
 * @param {string} visitMonth
 * @param {string} productName
 * @param {string} customerKey
 * @param {string} visitResult
 * @param {string} internalConclusion
 * @param {string} remark
 * @param {number} occurrence
 */
export function visitContentRecordId(visitMonth, productName, customerKey, visitResult, internalConclusion, remark, occurrence) {
  return hashVisitKey([visitMonth, productName, customerKey, visitResult, internalConclusion, remark, occurrence])
}

/**
 * @param {Record<string, unknown>} mappedRow applyColumnMap 后的标准字段行
 */
export function normalizeCustomerVisitRow(mappedRow) {
  const row = mappedRow || {}
  const visitMonth = String(row.visitMonth ?? row['数据月份'] ?? '').trim()
  const productName = String(row.productName ?? row.productSpec ?? row['产品名称'] ?? '').trim()
  const customerName = String(row.customerName ?? row['客户名称'] ?? '').trim()
  const customerCode = String(row.customerCode ?? row['客户编码'] ?? '').trim()
  const userFeedbackText = String(row.userFeedbackText ?? row['用户反馈原文'] ?? '').trim()
  const assigneeName = String(row.assigneeName ?? row['经办人'] ?? '').trim()
  const scoreSource = ''
  const ratingText = ''
  const userInfo = String(
    row.userInfo
    ?? row['用户信息']
    ?? [customerName, customerCode].filter(Boolean).join(' / '),
  ).trim()
  const userInfoDetail = String(row.userInfoDetail ?? userInfo).trim()
  const visitResult = String(row.visitResult ?? row['回访结果'] ?? '').trim()
  const visitFeedbackDetail = visitResult
  const internalConclusion = String(row.internalConclusion ?? row['内部评估'] ?? '').trim()
  const internalEvaluationDetail = internalConclusion
  const remark = String(row.remark ?? row['备注'] ?? '').trim()
  const feedbackSummary = String(row.feedbackSummary ?? visitResult).trim()
  const jiraId = ''
  const ratingRecordId = ''
  const ratingScore = parseRatingScoreFromText(ratingText)
  const channel = SCORE_SOURCE_TO_CHANNEL[scoreSource] || ''

  return {
    visitMonth,
    productName,
    customerName,
    customerCode,
    feedbackSummary,
    userFeedbackText,
    assigneeName,
    scoreSource,
    ratingText,
    userInfo,
    userInfoDetail,
    visitResult,
    visitFeedbackDetail,
    internalConclusion,
    internalEvaluationDetail,
    remark,
    jiraId,
    ratingRecordId,
    ratingScore: Number.isFinite(ratingScore) ? ratingScore : undefined,
    channel,
  }
}

/**
 * @param {import('../types.js').FeedbackRecord | Record<string, unknown>} record
 */
function recordRecencyKey(record) {
  return String(record.createdAt || record.importedAt || record.updatedAt || '')
}

/**
 * @param {Array<import('../types.js').FeedbackRecord | Record<string, unknown>>} list
 */
function pickMostRecent(list) {
  return [...list].sort((a, b) => recordRecencyKey(b).localeCompare(recordRecencyKey(a)))[0]
}

/**
 * @param {ReturnType<typeof normalizeCustomerVisitRow>} visit
 */
function buildCustomerKey(visit) {
  return [visit.customerCode, visit.customerName, visit.userInfo]
    .map((item) => String(item || '').trim())
    .find(Boolean) || ''
}

/**
 * @param {import('../types.js').FeedbackRecord | Record<string, unknown>} record
 * @param {ReturnType<typeof normalizeCustomerVisitRow>} visit
 */
function recordMatchesCustomer(record, visit) {
  const recordCode = String(record.customerCode || '').trim()
  const recordName = String(record.customerName || '').trim()
  const visitCode = String(visit.customerCode || '').trim()
  const visitName = String(visit.customerName || '').trim()
  const visitUserInfo = String(visit.userInfo || '').trim()

  if (visitCode && recordCode) return recordCode === visitCode
  if (visitName && recordName) return recordName === visitName
  if (visitCode && visitUserInfo && recordCode && visitUserInfo.includes(recordCode)) return true
  if (visitName && visitUserInfo && recordName && visitUserInfo.includes(recordName)) return true
  return false
}

/**
 * 软匹配 library 用后即评明细
 * 优先级：ratingRecordId > channel+product+customerCode/Name > score+visitMonth
 * @param {Array<import('../types.js').FeedbackRecord | Record<string, unknown>>} candidates
 * @param {ReturnType<typeof normalizeCustomerVisitRow>} visit
 * @returns {{
 *   record: (import('../types.js').FeedbackRecord | Record<string, unknown>) | null
 *   matchedBy: string | null
 *   multiMatch: boolean
 *   skipAttach: boolean
 * }}
 */
export function matchLibraryRecord(candidates, visit) {
  const library = (candidates || []).filter((r) => isPostUseRatingLibraryRecord(r))
  const channel = visit.channel || SCORE_SOURCE_TO_CHANNEL[visit.scoreSource] || ''

  if (channel === 'callback') {
    return { record: null, matchedBy: null, multiMatch: false, skipAttach: true }
  }

  if (visit.ratingRecordId) {
    const hit = library.find(
      (r) => r.id === visit.ratingRecordId || r.ratingId === visit.ratingRecordId,
    )
    if (hit) {
      return { record: hit, matchedBy: 'ratingRecordId', multiMatch: false, skipAttach: false }
    }
  }

  let pool = library
  if (channel === 'sms' || channel === 'console') {
    pool = pool.filter((r) => r.channel === channel)
  }

  const product = String(visit.productName || '').trim()
  if (product) {
    pool = pool.filter((r) => String(r.productName || r.product || '').trim() === product)
  }

  const withCustomer = pool.filter((r) => recordMatchesCustomer(r, visit))

  /** @param {typeof pool} list @param {string} by */
  const finish = (list, by) => {
    if (!list.length) return { record: null, matchedBy: null, multiMatch: false, skipAttach: false }
    let narrowed = list
    if (Number.isFinite(visit.ratingScore)) {
      const byScore = narrowed.filter((r) => Number(r.ratingScore) === visit.ratingScore)
      if (byScore.length) narrowed = byScore
    }
    if (visit.visitMonth) {
      const byMonth = narrowed.filter((r) => String(r.importMonth || '') === visit.visitMonth)
      if (byMonth.length) narrowed = byMonth
    }
    return {
      record: pickMostRecent(narrowed),
      matchedBy: by,
      multiMatch: narrowed.length > 1,
      skipAttach: false,
    }
  }

  if (withCustomer.length) {
    return finish(withCustomer, 'channel+product+customer')
  }

  if (pool.length && (Number.isFinite(visit.ratingScore) || visit.visitMonth)) {
    return finish(pool, 'channel+product+score+month')
  }

  return { record: null, matchedBy: null, multiMatch: false, skipAttach: false }
}

/**
 * @param {{
 *   rows: Record<string, unknown>[]
 *   libraryRecords: Array<import('../types.js').FeedbackRecord | Record<string, unknown>>
 *   importBatchId?: string
 *   importMonth?: string
 * }} input
 */
export function runCustomerVisitImportDryRun({ rows, libraryRecords, importBatchId, importMonth }) {
  const importedAt = new Date().toISOString()
  /** @type {import('./visitRecords.js').PostUseVisitRecord[]} */
  const visitRecords = []
  /** @type {Array<{ id: string; customerVisit: Record<string, unknown> }>} */
  const recordPatches = []
  /** @type {Array<{ rowIndex: number; reason: string; visit: ReturnType<typeof normalizeCustomerVisitRow> }>} */
  const unmatched = []
  /** @type {Array<{ rowIndex: number; message: string }>} */
  const warnings = []
  let matchedCount = 0
  let metaOnlyCount = 0
  let detailedFieldMissingCount = 0
  let detailedFieldCompleteCount = 0
  const contentCounts = new Map()

  ;(rows || []).forEach((raw, i) => {
    const rowIndex = i + 1
    const visit = normalizeCustomerVisitRow(raw)
    if (!visit.visitMonth || !visit.productName || (!visit.customerName && !visit.customerCode)) {
      unmatched.push({ rowIndex, reason: '缺少数据月份/产品名称/客户名称或客户编码', visit })
      return
    }

    const customerKey = buildCustomerKey(visit)
    const month = importMonth || visit.visitMonth
    const contentKey = [
      month,
      visit.productName,
      customerKey,
      visit.visitResult,
      visit.internalConclusion,
      visit.remark,
    ].join('\0')
    const occurrence = contentCounts.get(contentKey) || 0
    contentCounts.set(contentKey, occurrence + 1)
    const id = visitContentRecordId(
      month,
      visit.productName,
      customerKey,
      visit.visitResult,
      visit.internalConclusion,
      visit.remark,
      occurrence,
    )
    const visitMeta = {
      id,
      visitMonth: visit.visitMonth,
      importMonth: month,
      productName: visit.productName,
      customerName: visit.customerName,
      customerCode: visit.customerCode,
      feedbackSummary: visit.feedbackSummary,
      userFeedbackText: visit.userFeedbackText,
      assigneeName: visit.assigneeName || '',
      scoreSource: visit.scoreSource,
      ratingText: visit.ratingText,
      userInfo: visit.userInfo,
      userInfoDetail: visit.userInfoDetail || visit.userInfo,
      visitResult: visit.visitResult,
      visitFeedbackDetail: visit.visitFeedbackDetail || visit.visitResult,
      internalConclusion: visit.internalConclusion,
      internalEvaluationDetail: visit.internalEvaluationDetail || visit.internalConclusion,
      remark: visit.remark,
      jiraId: visit.jiraId || '',
      updatedAt: importedAt,
    }
    visitRecords.push(visitMeta)

    const hasDetailedFields = Boolean(
      visit.visitMonth &&
      visit.productName &&
      visit.customerName &&
      visit.customerCode &&
      (visit.visitFeedbackDetail || visit.visitResult) &&
      (visit.internalEvaluationDetail || visit.internalConclusion),
    )
    if (hasDetailedFields) {
      detailedFieldCompleteCount += 1
    } else {
      detailedFieldMissingCount += 1
    }

    const match = matchLibraryRecord(libraryRecords, visit)
    if (match.skipAttach || visit.channel === 'callback') {
      metaOnlyCount += 1
      return
    }

    if (!match.record?.id) {
      unmatched.push({ rowIndex, reason: '未匹配到短信/控制台评价明细', visit })
      return
    }

    matchedCount += 1
    if (match.multiMatch) {
      warnings.push({ rowIndex, message: '多条候选，已取最近一条并标记 multiMatch' })
    }

    recordPatches.push({
      id: String(match.record.id),
      customerVisit: {
        visitMonth: visit.visitMonth,
        importMonth: importMonth || visit.visitMonth,
        productName: visit.productName,
        customerName: visit.customerName,
        customerCode: visit.customerCode,
        feedbackSummary: visit.feedbackSummary,
        userFeedbackText: visit.userFeedbackText,
        assigneeName: visit.assigneeName || '',
        scoreSource: visit.scoreSource,
        ratingText: visit.ratingText,
        userInfo: visit.userInfo,
        userInfoDetail: visit.userInfoDetail || visit.userInfo,
        visitResult: visit.visitResult,
        visitFeedbackDetail: visit.visitFeedbackDetail || visit.visitResult,
        internalConclusion: visit.internalConclusion,
        internalEvaluationDetail: visit.internalEvaluationDetail || visit.internalConclusion,
        remark: visit.remark,
        jiraId: visit.jiraId || undefined,
        importBatchId: importBatchId || '',
        importedAt,
        matchedBy: match.matchedBy,
        multiMatch: match.multiMatch,
      },
    })
  })

  return {
    visitRecords,
    recordPatches,
    unmatched,
    warnings,
    matchedCount,
    metaOnlyCount,
    visitMetaCount: visitRecords.length,
    detailedFieldMissingCount,
    detailedFieldCompleteCount,
  }
}

/**
 * @param {{
 *   adapter: { getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void>; putRecords?: (records: unknown[]) => Promise<void> }
 *   rows: Record<string, unknown>[]
 *   libraryRecords: Array<import('../types.js').FeedbackRecord | Record<string, unknown>>
 *   importBatchId?: string
 *   importMonth?: string
 *   updateRecords?: (records: unknown[]) => Promise<void>
 *   putRecords?: (records: unknown[]) => Promise<void>
 * }} input
 */
export async function executeCustomerVisitImport({
  adapter,
  rows,
  libraryRecords,
  importBatchId,
  importMonth,
  updateRecords,
  putRecords,
}) {
  const dry = runCustomerVisitImportDryRun({ rows, libraryRecords, importBatchId, importMonth })

  let visits = await loadVisitRecords(adapter)
  const seenIdentity = new Set()
  for (const item of dry.visitRecords) {
    const customerKey = buildCustomerKey(item)
    const month = item.importMonth || item.visitMonth
    const identity = [month, item.productName, customerKey].join('\0')
    const isFirst = !seenIdentity.has(identity)
    seenIdentity.add(identity)
    if (isFirst) {
      const legacyId = stableVisitRecordId(month, item.productName, customerKey)
      if (legacyId !== item.id && visits.some((record) => record.id === legacyId)) {
        item.id = legacyId
      }
    }
    visits = upsertVisitRecord(visits, item)
  }
  await saveVisitRecords(adapter, visits)

  if (dry.recordPatches.length) {
    const byId = new Map((libraryRecords || []).map((r) => [String(r.id), r]))
    const updated = dry.recordPatches
      .map((p) => {
        const base = byId.get(p.id)
        if (!base) return null
        return { ...base, customerVisit: p.customerVisit }
      })
      .filter(Boolean)

    const writer =
      typeof updateRecords === 'function'
        ? updateRecords
        : typeof putRecords === 'function'
          ? putRecords
          : adapter?.putRecords
            ? (recs) => adapter.putRecords(recs)
            : null
    if (writer && updated.length) {
      await writer(updated)
    }
  }

  return dry
}
