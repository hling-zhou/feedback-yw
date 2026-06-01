import { useMemo } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import {
  formatBackgroundTaskBlockedTip,
  formatBackgroundTaskRemoteBanner,
  isBackgroundTaskLockActive,
  isBackgroundTaskLockHeldByUser,
} from '../domain/backgroundTaskLock.js'
import { RETAG_BLOCKED_BY_IMPORT_TIP, RETAG_IMPORT_BLOCKED_TIP, RETAG_IN_PROGRESS_TIP } from './retagSession.js'
import {
  IMPORT_ALREADY_IN_PROGRESS_TIP,
  IMPORT_REBUILD_DISABLED_TIP,
} from './importSession.js'

/**
 * 合并本机 session 与服务端全局锁，供导入 / 批量打标 / 刷新洞察等入口复用。
 */
export function useSharedBackgroundTaskBlock() {
  const { user } = useAuth()
  const { sharedBackgroundTask, importSession, retagSession } = useInsights()

  return useMemo(() => {
    const localImport = importSession.active
    const localRetag = retagSession.active
    const remoteActive =
      isBackgroundTaskLockActive(sharedBackgroundTask) &&
      !isBackgroundTaskLockHeldByUser(sharedBackgroundTask, user?.id)

    const importBlocked = localImport || localRetag || remoteActive
    const retagBlocked = localImport || remoteActive
    const rebuildBlocked = localImport || localRetag || remoteActive

    const remoteBlockedTip = remoteActive
      ? formatBackgroundTaskBlockedTip(sharedBackgroundTask)
      : undefined
    const remoteBannerText = remoteActive
      ? formatBackgroundTaskRemoteBanner(sharedBackgroundTask)
      : undefined

    const importBlockedTip = localImport
      ? IMPORT_ALREADY_IN_PROGRESS_TIP
      : localRetag
        ? RETAG_IMPORT_BLOCKED_TIP
        : remoteBlockedTip

    const retagBlockedTip = localImport
      ? RETAG_BLOCKED_BY_IMPORT_TIP
      : localRetag
        ? RETAG_IN_PROGRESS_TIP
        : remoteBlockedTip

    const rebuildBlockedTip = localRetag
      ? '批量重新打标进行中，请待打标完成后再刷新洞察'
      : localImport
        ? IMPORT_REBUILD_DISABLED_TIP
        : remoteBlockedTip

    return {
      localImport,
      localRetag,
      remoteActive,
      sharedBackgroundTask,
      importBlocked,
      retagBlocked,
      rebuildBlocked,
      importBlockedTip,
      retagBlockedTip,
      rebuildBlockedTip,
      remoteBannerText,
    }
  }, [sharedBackgroundTask, importSession.active, retagSession.active, user?.id])
}
