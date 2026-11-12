import { LEGACY_INSIGHT_PERIOD_ID } from '../src/domain/constants.js'
import { normalizeYearMonth } from '../src/domain/insightPeriod.js'
import { resolveWorkbenchHistoryMonthRange } from '../src/lib/workbenchStoredAggregates.js'
import { getDb } from './db.js'

let onDirty = null

export function setInsightSnapshotDirtyListener(listener) {
  onDirty = listener
}

export function notifyInsightSnapshotDirty() {
  if (onDirty) queueMicrotask(onDirty)
}

export function markInsightSnapshotPeriodDirty(periodId) {
  if (!periodId) return
  const db = getDb()
  db.prepare(`
    INSERT INTO insight_snapshot_dirty_periods (insight_period_id, generation, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(insight_period_id) DO UPDATE SET
      generation = generation + 1,
      updated_at = excluded.updated_at
  `).run(periodId, new Date().toISOString())
  db.prepare(`
    UPDATE snapshots SET payload = json_set(payload, '$.status', 'stale')
    WHERE insight_period_id = ? AND json_extract(payload, '$.status') IN ('ready', 'rebuilding')
  `).run(periodId)
  notifyInsightSnapshotDirty()
}

function recordMonth(record) {
  return normalizeYearMonth(String(record?.importMonth || record?.createdAt || '').slice(0, 7))
}

function periodCoversMonth(period, month, hasLegacySnapshot) {
  // 默认历史周期跨度极大；只有用户已生成过该周期快照时才维护它。
  if (period.id === LEGACY_INSIGHT_PERIOD_ID) return hasLegacySnapshot
  if (!period.granularity) {
    return month >= String(period.startDate || '').slice(0, 7)
      && month <= String(period.endDate || '').slice(0, 7)
  }
  const range = resolveWorkbenchHistoryMonthRange(period)
  return Boolean(range.startMonth && range.endMonth && month >= range.startMonth && month <= range.endMonth)
}

/** Record writes call this inside their SQLite transaction, so a committed write always has a dirty marker. */
export function markInsightSnapshotsDirtyForRecords(records) {
  const months = new Set((records || []).map(recordMonth).filter(Boolean))
  if (!months.size) return []
  const db = getDb()
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('insight_periods')
  const periods = row ? JSON.parse(row.value) : []
  const hasLegacySnapshot = Boolean(db.prepare(
    'SELECT 1 FROM snapshots WHERE insight_period_id = ? LIMIT 1',
  ).get(LEGACY_INSIGHT_PERIOD_ID))
  const affected = periods.filter((period) => [...months].some((month) => periodCoversMonth(period, month, hasLegacySnapshot)))
  if (!affected.length) return []
  for (const period of affected) markInsightSnapshotPeriodDirty(period.id)
  return affected.map((period) => period.id)
}

export function listDirtyInsightPeriods() {
  return getDb().prepare(`
    SELECT insight_period_id AS periodId, generation, updated_at AS updatedAt
    FROM insight_snapshot_dirty_periods ORDER BY updated_at, insight_period_id
  `).all()
}

export function dirtyInsightGeneration(periodId) {
  return getDb().prepare('SELECT generation FROM insight_snapshot_dirty_periods WHERE insight_period_id = ?')
    .get(periodId)?.generation || 0
}

export function clearDirtyInsightPeriodIfUnchanged(periodId, generation) {
  if (!generation) return false
  return getDb().prepare(`
    DELETE FROM insight_snapshot_dirty_periods WHERE insight_period_id = ? AND generation = ?
  `).run(periodId, generation).changes > 0
}
