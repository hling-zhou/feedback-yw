import { enqueueInsightRebuild, waitForInsightRebuildCompletion } from './insightRebuildJob.js'
import { listBackgroundTasks } from './backgroundTaskLock.js'
import { storageRepository } from './storageRepository.js'
import { dirtyInsightGeneration } from './insightSnapshotDirty.js'
import { pruneRecordChanges } from './recordChangeLog.js'

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const BUSY_RETRY_MS = 15 * 1000
const MAX_STALE_RETRIES = 2

export function nextBeijingFive(now = new Date()) {
  const local = new Date(now.getTime() + BEIJING_OFFSET_MS)
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 5) - BEIJING_OFFSET_MS
  if (target <= now.getTime()) target += 24 * 60 * 60 * 1000
  return new Date(target)
}

/** The injected operations keep timer and interruption behavior testable without a live SQLite file. */
export function createInsightRefreshScheduler({
  listTasks = listBackgroundTasks,
  listPeriods = () => storageRepository.listInsightPeriods(),
  enqueue = enqueueInsightRebuild,
  wait = waitForInsightRebuildCompletion,
  dirtyGeneration = dirtyInsightGeneration,
  prune = pruneRecordChanges,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
} = {}) {
  let dailyTimer = null
  let busyTimer = null
  let running = false
  let started = false
  let pendingDailyRun = false
  let queuedDailyRun = false
  let pendingPeriodIds = null
  const staleRetries = new Map()

  const hasWritingTask = () => listTasks().some((task) =>
    ['import', 'retag', 'post_use_journey'].includes(task.type),
  )

  const scheduleBusyRetry = () => {
    if (!started || busyTimer) return
    busyTimer = setTimer(() => {
      busyTimer = null
      void runDailyFullRebuild()
    }, BUSY_RETRY_MS)
  }

  async function runDailyFullRebuild() {
    if (!started || running || !pendingDailyRun) return
    if (hasWritingTask()) {
      scheduleBusyRetry()
      return
    }
    running = true
    try {
      // 每日重建全部已保存周期；逐周期运行，避免 SQLite 读写争用。
      if (!pendingPeriodIds) {
        pendingPeriodIds = [...new Set(listPeriods().map((period) => period.id).filter(Boolean))]
      }
      while (pendingPeriodIds.length) {
        if (!started) return
        if (hasWritingTask()) {
          scheduleBusyRetry()
          return
        }
        const periodId = pendingPeriodIds[0]
        try {
          const { job } = await enqueue(periodId, 'system-05:00')
          const finished = await wait(job.id)
          if (finished?.status !== 'succeeded') {
            logger.warn('[insight-refresh] daily rebuild failed:', periodId, finished?.errorSummary)
          } else if (dirtyGeneration(periodId) > 0) {
            // 重建途中有写入，快照仍过期；在任务结束后补做该周期。
            if (hasWritingTask()) {
              scheduleBusyRetry()
              return
            }
            const retries = staleRetries.get(periodId) || 0
            if (retries < MAX_STALE_RETRIES) {
              staleRetries.set(periodId, retries + 1)
              pendingPeriodIds.shift()
              pendingPeriodIds.push(periodId)
              continue
            }
            logger.warn('[insight-refresh] daily rebuild remained stale:', periodId)
          }
        } catch (error) {
          if (error?.code === 'INSIGHT_REBUILD_BUSY') {
            scheduleBusyRetry()
            return
          }
          logger.error('[insight-refresh] daily rebuild error:', periodId, error)
        }
        pendingPeriodIds.shift()
      }
      pendingDailyRun = false
      pendingPeriodIds = null
      staleRetries.clear()
      prune()
    } catch (error) {
      logger.error('[insight-refresh] daily sweep error:', error)
      if (pendingDailyRun) scheduleBusyRetry()
    } finally {
      running = false
      if (started && queuedDailyRun && !pendingDailyRun) {
        queuedDailyRun = false
        pendingDailyRun = true
        pendingPeriodIds = null
        staleRetries.clear()
        queueMicrotask(() => void runDailyFullRebuild())
      }
    }
  }

  function armDaily() {
    if (!started) return
    const current = now()
    const delay = nextBeijingFive(current).getTime() - current.getTime()
    dailyTimer = setTimer(() => {
      if (pendingDailyRun || running) {
        queuedDailyRun = true
      } else {
        pendingDailyRun = true
        pendingPeriodIds = null
        void runDailyFullRebuild()
      }
      armDaily()
    }, delay)
  }

  return {
    start() {
      if (started) return () => {}
      started = true
      armDaily()
      return () => {
        started = false
        pendingDailyRun = false
        queuedDailyRun = false
        pendingPeriodIds = null
        staleRetries.clear()
        if (dailyTimer) clearTimer(dailyTimer)
        if (busyTimer) clearTimer(busyTimer)
        dailyTimer = null
        busyTimer = null
      }
    },
  }
}

const scheduler = createInsightRefreshScheduler()

/** Only Beijing 05:00 starts automatic rebuilds. Record writes merely mark snapshots stale. */
export function startInsightRefreshScheduler() {
  return scheduler.start()
}
