import { useMemo } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import {
  formatBackgroundTaskBlockedTip,
  backgroundTasksConflict,
  findConflictingBackgroundTask,
  formatBackgroundTaskRemoteBanner,
  importSessionConflicts,
  retagStartConflict,
  importMonthOverlapsPeriod,
  isBackgroundTaskLockHeldByUser,
  isTicketImportSource,
} from '../domain/backgroundTaskLock.js'
import {
  RETAG_BLOCKED_BY_IMPORT_TIP,
  RETAG_IMPORT_BLOCKED_TIP,
  RETAG_IN_PROGRESS_TIP,
} from '../lib/retagSession.js'
import { IMPORT_ALREADY_IN_PROGRESS_TIP } from '../lib/importSession.js'

/**
 * 合并本机 session 与服务端全局锁，供导入 / 批量打标 / 刷新洞察等入口复用。
 */
/**
 * @param {{ dataMonth?: string; dataSourceType?: string }} [options]
 */
export function useSharedBackgroundTaskBlock(options = {}) {
  const { user } = useAuth()
  const { sharedBackgroundTasks, importSession, retagSession, currentPeriod } = useInsights()
  const { dataMonth, dataSourceType } = options

  return useMemo(() => {
    const tasks = sharedBackgroundTasks || []
    const localImport = importSession.active
    const localRetag = retagSession.active
    const localImportConflict = importSessionConflicts(importSession, { dataMonth, dataSourceType })
    const incomingImport =
      dataMonth && dataSourceType
        ? { type: /** @type {const} */ ('import'), meta: { dataMonth, dataSourceType } }
        : null
    const importConflict = incomingImport ? findConflictingBackgroundTask(tasks, incomingImport) : null
    const retagRuns = retagSession.runs?.length
      ? retagSession.runs
      : retagSession.active
        ? [retagSession]
        : []
    const localRetagVsImport = Boolean(
      incomingImport &&
        retagRuns.some((run) =>
          backgroundTasksConflict(
            {
              type: 'retag',
              meta: {
                periodId: run.periodId,
                periodStart: run.periodStart,
                periodEnd: run.periodEnd,
              },
            },
            incomingImport,
          ),
        ),
    )
    const retagIncoming = currentPeriod
      ? {
          type: /** @type {const} */ ('retag'),
          meta: {
            periodId: currentPeriod.id,
            periodStart: currentPeriod.startDate,
            periodEnd: currentPeriod.endDate,
          },
        }
      : null
    const retagConflict = retagIncoming ? findConflictingBackgroundTask(tasks, retagIncoming) : null

    const importBlocked = Boolean(importConflict) || localImportConflict || Boolean(localRetagVsImport)
    const localRetagStartConflict = retagStartConflict(importSession, retagSession, {
      periodId: currentPeriod?.id,
      periodStart: currentPeriod?.startDate,
      periodEnd: currentPeriod?.endDate,
    })
    const retagBlocked = Boolean(retagConflict) || Boolean(localRetagStartConflict)
    const rebuildBlocked = tasks.some((task) => {
      if (task.type === 'retag') return task.meta?.periodId === currentPeriod?.id
      return importMonthOverlapsPeriod(
        /** @type {string} */ (task.meta?.dataMonth),
        currentPeriod?.startDate,
        currentPeriod?.endDate,
      )
    }) || localImport || localRetag

    const conflictTip = (task) =>
      task ? formatBackgroundTaskBlockedTip(task) : undefined
    const remoteBannerText = tasks
      .filter((task) => !isBackgroundTaskLockHeldByUser(task, user?.id))
      .map((task) => formatBackgroundTaskRemoteBanner(task))
      .filter(Boolean)
      .join('；') || undefined
    const ownedTasks = tasks.filter((task) => isBackgroundTaskLockHeldByUser(task, user?.id))

    const importBlockedTip = importConflict
      ? conflictTip(importConflict)
      : localRetagVsImport
        ? RETAG_IMPORT_BLOCKED_TIP
        : localImportConflict
          ? IMPORT_ALREADY_IN_PROGRESS_TIP
          : undefined

    const retagBlockedTip = retagConflict
      ? conflictTip(retagConflict)
      : localRetagStartConflict === 'import'
        ? RETAG_BLOCKED_BY_IMPORT_TIP
        : localRetagStartConflict === 'retag'
          ? RETAG_IN_PROGRESS_TIP
          : undefined

    const rebuildBlockedTip = rebuildBlocked
      ? '当前周期有导入或重新打标进行中，请待完成后再刷新洞察'
      : undefined

    const detailSaveBlocked = tasks.some(
      (task) => task.type === 'retag' || (task.type === 'import' && isTicketImportSource(/** @type {string} */ (task.meta?.dataSourceType))),
    ) || localImport || localRetag
    const detailSaveBlockedTip = detailSaveBlocked
      ? '导入或重新打标进行中，请待完成后再保存工单'
      : undefined

    return {
      localImport,
      localRetag,
      remoteActive: tasks.some((task) => !isBackgroundTaskLockHeldByUser(task, user?.id)),
      ownLockOrphan: false,
      ownedBannerText: undefined,
      ownedLockInterrupted: false,
      ownedLockType: undefined,
      ownedTasks,
      sharedBackgroundTasks: tasks,
      sharedBackgroundTask: tasks[0] ?? null,
      importBlocked,
      retagBlocked,
      rebuildBlocked,
      detailSaveBlocked,
      importBlockedTip,
      retagBlockedTip,
      rebuildBlockedTip,
      detailSaveBlockedTip,
      remoteBannerText,
    }
  }, [
    currentPeriod,
    dataMonth,
    dataSourceType,
    importSession,
    retagSession,
    sharedBackgroundTasks,
    user?.id,
  ])
}
