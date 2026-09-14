import { DATA_SOURCE_TYPES } from '../domain/enums.js'
import { overviewSnapshotId, sourceSnapshotId } from '../domain/snapshot.js'
import { buildSourceSnapshot } from './buildSourceSnapshot.js'
import { buildOverviewSnapshot } from './buildOverviewSnapshot.js'
import { previousPeriodIdFromPeriod } from '../domain/insightPeriod.js'
import { filterRecordsForScope } from './recordScope.js'
import { listOrderVolumes } from '../storage/orderVolumeStore.js'
import { yieldToMainThread } from '../lib/yieldToMainThread.js'
import { isTicketSource } from '../lib/importUtils.js'
import { buildImpactFocusSummaries } from '../lib/ticketImpactFocus.js'

/** @typedef {import('../lib/storage.js').AppSettings} AppSettings */

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */
/** @typedef {import('../domain/snapshot.js').InsightSnapshot} InsightSnapshot */
/** @typedef {import('../domain/snapshot.js').OverviewSnapshot} OverviewSnapshot */
/** @typedef {import('../storage/adapter.js').StorageAdapter} StorageAdapter */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */

/**
 * @param {InsightSnapshot | OverviewSnapshot} snap
 * @param {boolean} forceStale
 */
export function overlayStaleStatus(snap, forceStale) {
  if (!snap || !forceStale || snap.status === 'rebuilding' || snap.status === 'failed') {
    return snap
  }
  return { ...snap, status: 'stale' }
}

/**
 * @param {OverviewSnapshot | InsightSnapshot | null} snap
 */
export function isOverviewSnapshot(snap) {
  return Boolean(snap && snap.id?.startsWith('overview:'))
}

/**
 * @param {StorageAdapter} adapter
 * @param {string} insightPeriodId
 */
export async function loadSnapshotsForPeriod(adapter, insightPeriodId) {
  const all = await adapter.listSnapshotsByPeriod(insightPeriodId)
  /** @type {Partial<Record<DataSourceType, InsightSnapshot>>} */
  const sourceSnapshots = {}
  /** @type {OverviewSnapshot | null} */
  let overviewSnapshot = null

  for (const snap of all) {
    if (isOverviewSnapshot(snap)) {
      overviewSnapshot = /** @type {OverviewSnapshot} */ (snap)
    } else if (/** @type {InsightSnapshot} */ (snap).dataSourceType) {
      sourceSnapshots[/** @type {InsightSnapshot} */ (snap).dataSourceType] =
        /** @type {InsightSnapshot} */ (snap)
    }
  }

  return { sourceSnapshots, overviewSnapshot }
}

/**
 * @param {Object} params
 * @param {StorageAdapter} params.adapter
 * @param {InsightPeriod} params.period
 * @param {DataSourceType} params.dataSourceType
 * @param {FeedbackRecord[]} params.feedbacks
 */
export async function rebuildSourceSnapshot({
  adapter,
  period,
  dataSourceType,
  feedbacks,
  settings = null,
}) {
  const insightPeriodId = period.id
  const records = filterRecordsForScope(feedbacks, period, dataSourceType)
  const ticketRecordsForFollowUp = [
    ...filterRecordsForScope(feedbacks, period, 'complaint_ticket'),
    ...filterRecordsForScope(feedbacks, period, 'consultation_ticket'),
  ]

  const previousPeriodId = previousPeriodIdFromPeriod(period)
  /** @type {import('../domain/overviewConclusions.js').OverviewRecommendation[]} */
  let previousRecommendations = []
  if (previousPeriodId && isTicketSource(dataSourceType)) {
    const prevSnap = await adapter.getSnapshot(sourceSnapshotId(dataSourceType, previousPeriodId))
    previousRecommendations =
      /** @type {{ planningConclusions?: { recommendations?: unknown[] } }} */ (
        prevSnap?.aggregates
      )?.planningConclusions?.recommendations || []
  }

  let snapshot = await buildSourceSnapshot({
    insightPeriodId,
    dataSourceType,
    records,
    status: 'ready',
    ticketRecordsForFollowUp,
    period,
    settings,
    previousRecommendations,
    previousPeriodId: previousPeriodId || undefined,
  })

  if (isTicketSource(dataSourceType)) {
    try {
      const impactFocusSummaries = await buildImpactFocusSummaries({
        sourceLabel: dataSourceType === 'complaint_ticket' ? '投诉工单' : '咨询工单',
        recommendations:
          /** @type {{ planningConclusions?: { recommendations?: import('../domain/overviewConclusions.js').OverviewRecommendation[] } }} */ (
            snapshot.aggregates
          )?.planningConclusions?.recommendations || [],
        records,
        settings,
      })
      snapshot = {
        ...snapshot,
        aggregates: {
          ...snapshot.aggregates,
          impactFocusSummaries,
        },
      }
    } catch (error) {
      console.warn('[snapshot-service] 生成 impactFocusSummaries 失败:', error)
    }
  }

  await adapter.putSnapshot(snapshot)
  return snapshot
}

/**
 * @param {Object} params
 * @param {StorageAdapter} params.adapter
 * @param {InsightPeriod} params.period
 * @param {FeedbackRecord[]} params.feedbacks
 * @param {Partial<Record<DataSourceType, InsightSnapshot>>} params.sourceSnapshots
 */
export async function rebuildOverviewSnapshot({
  adapter,
  period,
  feedbacks,
  sourceSnapshots,
  settings = null,
}) {
  const orderVolumes = await listOrderVolumes(adapter)
  const previousPeriodId = previousPeriodIdFromPeriod(period)

  // 概览快照按问题（stableKey = product+fam+sub 的哈希）合并投诉+咨询
  // 同一问题在投诉快照和咨询快照中各有一个 item，合并后 c/q 保持各自真实值
  const complaintRecs =
    sourceSnapshots.complaint_ticket?.aggregates?.planningConclusions?.recommendations || []
  const consultationRecs =
    sourceSnapshots.consultation_ticket?.aggregates?.planningConclusions?.recommendations || []
  const mergedRecommendations = mergeRecommendationsByProblem(complaintRecs, consultationRecs)

  // 合并门禁报告（取投诉+咨询中最差的轮次状态）
  const complaintGate = sourceSnapshots.complaint_ticket?.aggregates?.planningConclusions?.gateReport
  const consultationGate = sourceSnapshots.consultation_ticket?.aggregates?.planningConclusions?.gateReport
  const mergedGateReport = mergeGateReports(complaintGate, consultationGate)

  let snapshot = buildOverviewSnapshot({
    insightPeriodId: period.id,
    period,
    feedbacks,
    sourceSnapshots,
    orderVolumes,
    status: 'ready',
    settings,
    // 传入合并后的 recommendations，buildOverviewSnapshot 不再调 buildOverviewConclusions 跑 V2
    mergedRecommendations,
    mergedGateReport,
  })

  // 移除旧的 recommendationsLlm 保留逻辑（新引擎不使用 LLM 润色）

  await adapter.putSnapshot(snapshot)
  return snapshot
}

/**
 * 合并投诉和咨询的门禁报告，取最差状态。
 * @param {object|null} a
 * @param {object|null} b
 * @returns {object|null}
 */
function mergeGateReports(a, b) {
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  return {
    rounds: Math.max(a.rounds || 0, b.rounds || 0),
    passed: a.passed && b.passed,
    failureCount: (a.failureCount || 0) + (b.failureCount || 0),
    escalated: a.escalated || b.escalated,
    failures: [...(a.failures || []), ...(b.failures || [])].slice(0, 20),
  }
}

/**
 * 按问题（stableKey = product+fam+sub 的哈希）合并投诉和咨询的 recommendations。
 * 同一问题在投诉快照中 c=X,q=0，在咨询快照中 c=0,q=Y，合并后 c=X,q=Y。
 * 单独的 source 快照不受影响——只有概览 tab 走此合并。
 * @param {object[]} complaintRecs
 * @param {object[]} consultationRecs
 * @returns {object[]}
 */
function mergeRecommendationsByProblem(complaintRecs, consultationRecs) {
  if (!complaintRecs.length && !consultationRecs.length) return []
  if (!complaintRecs.length) return consultationRecs
  if (!consultationRecs.length) return complaintRecs

  const merged = []
  const consultationByKey = new Map()
  for (const rec of consultationRecs) {
    consultationByKey.set(rec.stableKey || rec.id, rec)
  }

  // 投诉侧的每个 item：检查咨询侧是否有同 key 的 item
  for (const rec of complaintRecs) {
    const key = rec.stableKey || rec.id
    const matched = consultationByKey.get(key)
    if (matched) {
      const complaintN = rec.scale?.ticketCount || 0
      const consultationN = matched.scale?.ticketCount || 0
      const totalCount = complaintN + consultationN
      const complaintCount = rec.scale?.complaintCount || 0
      const consultationCount = matched.scale?.consultationCount || 0
      // 合并：c 取投诉侧，q 取咨询侧，n 取两者之和
      merged.push({
        ...rec,
        scale: {
          ...rec.scale,
          ticketCount: totalCount,
          complaintCount,
          consultationCount,
          // 投诉率基于合并后的总量重算
          complaintRate: totalCount > 0 ? (complaintCount / totalCount * 100) : 0,
          // 环比优先取投诉侧（投诉侧有值则用投诉侧，否则取咨询侧）
          moMPct: rec.scale?.moMPct !== undefined ? rec.scale.moMPct : matched.scale?.moMPct,
          moMAbs: rec.scale?.moMAbs !== undefined ? rec.scale.moMAbs : matched.scale?.moMAbs,
        },
        evidenceTicketIds: [
          ...(rec.evidenceTicketIds || []),
          ...(matched.evidenceTicketIds || []),
        ],
        sourceGroup: 'cross_source',
      })
      consultationByKey.delete(key)
    } else {
      merged.push(rec)
    }
  }

  // 咨询侧未被匹配的 item（投诉侧无对应问题）
  for (const rec of consultationByKey.values()) {
    merged.push(rec)
  }

  return merged
}

/**
 * 将周期内快照标记为 rebuilding（服务端 Job 开始前）
 * @param {import('../storage/adapter.js').StorageAdapter} adapter
 * @param {string} insightPeriodId
 */
export async function markPeriodSnapshotsRebuilding(adapter, insightPeriodId) {
  const { sourceSnapshots, overviewSnapshot } = await loadSnapshotsForPeriod(
    adapter,
    insightPeriodId,
  )
  for (const type of DATA_SOURCE_TYPES) {
    const snap = sourceSnapshots[type]
    if (snap) {
      await adapter.putSnapshot({ ...snap, status: 'rebuilding' })
    } else {
      await adapter.putSnapshot({
        ...await buildSourceSnapshot({
          insightPeriodId,
          dataSourceType: type,
          records: [],
          status: 'stale',
        }),
        status: 'rebuilding',
      })
    }
  }
  if (overviewSnapshot) {
    await adapter.putSnapshot({ ...overviewSnapshot, status: 'rebuilding' })
  }
}

/**
 * @param {StorageAdapter} adapter
 * @param {string} insightPeriodId
 */
export async function markPeriodSnapshotsStale(adapter, insightPeriodId) {
  const { sourceSnapshots, overviewSnapshot } = await loadSnapshotsForPeriod(
    adapter,
    insightPeriodId,
  )
  for (const type of DATA_SOURCE_TYPES) {
    const snap = sourceSnapshots[type]
    if (snap && snap.status === 'ready') {
      await adapter.putSnapshot({ ...snap, status: 'stale' })
    } else if (!snap) {
      const empty = await buildSourceSnapshot({
        insightPeriodId,
        dataSourceType: type,
        records: [],
        status: 'stale',
      })
      await adapter.putSnapshot(empty)
    }
  }
  if (overviewSnapshot) {
    await adapter.putSnapshot({ ...overviewSnapshot, status: 'stale' })
  }
}

/**
 * @param {StorageAdapter} adapter
 * @param {InsightPeriod} period
 * @param {FeedbackRecord[]} feedbacks
 * @param {(source: DataSourceType | 'overview', done: number, total: number, detail?: { engineRounds?: number, enginePassed?: boolean, engineEscalated?: boolean }) => void} [onProgress]
 * @param {AppSettings | null} [settings]
 */
export async function rebuildAllSnapshots(adapter, period, feedbacks, onProgress, settings = null) {
  const insightPeriodId = period.id
  const total = DATA_SOURCE_TYPES.length + 1
  let done = 0
  /** @type {Partial<Record<DataSourceType, InsightSnapshot>>} */
  const sourceSnapshots = {}

  for (const type of DATA_SOURCE_TYPES) {
    onProgress?.(type, done, total)
    await yieldToMainThread()
    const snap = await rebuildSourceSnapshot({
      adapter,
      period,
      dataSourceType: type,
      feedbacks,
      settings,
    })
    sourceSnapshots[type] = snap
    done += 1
    // 透传引擎轮次信息
    const gate = snap?.aggregates?.planningConclusions?.gateReport
    onProgress?.(type, done, total, gate ? {
      engineRounds: gate.rounds,
      enginePassed: gate.passed,
      engineEscalated: gate.escalated,
    } : undefined)
    await yieldToMainThread()
  }

  onProgress?.('overview', done, total)
  await yieldToMainThread()
  const overview = await rebuildOverviewSnapshot({
    adapter,
    period,
    feedbacks,
    sourceSnapshots,
    settings,
  })
  done += 1
  const overviewGate = overview?.conclusions?.gateReport
  onProgress?.('overview', done, total, overviewGate ? {
    engineRounds: overviewGate.rounds,
    enginePassed: overviewGate.passed,
    engineEscalated: overviewGate.escalated,
  } : undefined)

  return { sourceSnapshots, overviewSnapshot: overview }
}
