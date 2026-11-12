import { enqueueInsightRebuild, waitForInsightRebuildCompletion } from './insightRebuildJob.js'
import { listBackgroundTasks } from './backgroundTaskLock.js'
import { listDirtyInsightPeriods, setInsightSnapshotDirtyListener } from './insightSnapshotDirty.js'

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const RETRY_MS = 10 * 60 * 1000
const BUSY_RETRY_MS = 15 * 1000

let drainTimer = null
let dailyTimer = null
let draining = false
let started = false
const failedUntil = new Map()

export function nextBeijingFive(now = new Date()) {
  const local = new Date(now.getTime() + BEIJING_OFFSET_MS)
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 5) - BEIJING_OFFSET_MS
  if (target <= now.getTime()) target += 24 * 60 * 60 * 1000
  return new Date(target)
}

function scheduleDrain(delayMs = 1500) {
  if (!started) return
  if (drainTimer) clearTimeout(drainTimer)
  drainTimer = setTimeout(() => {
    drainTimer = null
    void drainDirtyPeriods()
  }, delayMs)
}

async function drainDirtyPeriods() {
  if (draining || !started) return
  draining = true
  try {
    for (let completed = 0; completed < 20; completed += 1) {
      const rows = listDirtyInsightPeriods()
      if (!rows.length) return
      // 打标和导入会流式写盘；等所有写入任务结束再读取快照输入。
      if (listBackgroundTasks().some((task) => ['import', 'retag', 'post_use_journey'].includes(task.type))) {
        scheduleDrain(BUSY_RETRY_MS)
        return
      }
      const row = rows.find((item) => (failedUntil.get(item.periodId) || 0) <= Date.now())
      if (!row) {
        scheduleDrain(RETRY_MS)
        return
      }
      try {
        const { job } = await enqueueInsightRebuild(row.periodId, 'system-auto')
        const finished = await waitForInsightRebuildCompletion(job.id)
        if (finished?.status !== 'succeeded') {
          failedUntil.set(row.periodId, Date.now() + RETRY_MS)
          console.warn('[insight-refresh] automatic rebuild failed:', row.periodId, finished?.errorSummary)
        } else {
          failedUntil.delete(row.periodId)
        }
      } catch (error) {
        failedUntil.set(row.periodId, Date.now() + RETRY_MS)
        console.error('[insight-refresh] automatic rebuild error:', row.periodId, error)
      }
    }
    if (listDirtyInsightPeriods().length) scheduleDrain(1500)
  } finally {
    draining = false
  }
}

function armDaily() {
  if (!started) return
  const delay = nextBeijingFive().getTime() - Date.now() + 1000
  dailyTimer = setTimeout(() => {
    scheduleDrain(0)
    armDaily()
  }, delay)
}

/** Start immediately after the API begins listening. The 05:00 sweep recovers leftover dirty periods. */
export function startInsightRefreshScheduler() {
  if (started) return () => {}
  started = true
  setInsightSnapshotDirtyListener(() => scheduleDrain())
  scheduleDrain(0)
  armDaily()
  return () => {
    started = false
    setInsightSnapshotDirtyListener(null)
    if (drainTimer) clearTimeout(drainTimer)
    if (dailyTimer) clearTimeout(dailyTimer)
    drainTimer = null
    dailyTimer = null
  }
}
