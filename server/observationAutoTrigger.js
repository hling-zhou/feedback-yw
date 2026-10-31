import { acquireBackgroundTaskLock, startBackgroundTaskHeartbeat } from './backgroundTaskLock.js'

/**
 * 导入完成后的留观自动识别自动触发（O3，DESIGN §4.3）。
 *
 * 与 /api/observation/scan 手动路由的差异：
 * - 手动路由由前端触发（参数可选月份/记录范围）；
 * - 本函数由导入 enrich 成功完成时内联触发（同批 records）；
 * 两者共用 enrichRunner mode observation_match 与结果 meta 键。
 *
 * 隔离性：独立后台任务锁（type=retag 通道，与导入锁已释放）；触发失败仅 warn，不影响导入主结果。
 */

const OBSERVATION_SCAN_RESULT_META_KEY = 'observation_scan_last_result'

/**
 * @param {{ records: string[], userId: string, username: string }} params
 * @returns {Promise<{ triggered: boolean, taskId?: string, reason?: string }>}
 */
export async function triggerObservationScanForRecords({ records, userId, username }) {
  const recordIds = (records || []).map((id) => String(id || '').trim()).filter(Boolean)
  if (!recordIds.length) {
    return { triggered: false, reason: 'no-records' }
  }
  let lock = null
  try {
    const acquired = acquireBackgroundTaskLock('retag', {
      id: userId,
      username,
      progress: '留观自动识别（导入后置）…',
      meta: {
        phase: 'server',
        source: '留观自动识别（导入触发）',
        total: recordIds.length,
      },
    })
    lock = acquired.lock
  } catch {
    // 锁被占用（如手动 scan 正在跑）——本批不触发，导入不受影响
    return { triggered: false, reason: 'lock-busy' }
  }
  const taskId = lock.id
  const stopHeartbeat = startBackgroundTaskHeartbeat(taskId)

  ;(async () => {
    try {
      const { runEnrichment } = await import('./enrichRunner.js')
      const result = await runEnrichment({
        mode: 'observation_match',
        taskId,
        records: [],
        recordIds,
        settings: {},
        userId,
        username,
        retagOptions: {},
      })
      const { storageRepository } = await import('./storageRepository.js')
      storageRepository.putMeta(OBSERVATION_SCAN_RESULT_META_KEY, {
        taskId,
        finishedAt: new Date().toISOString(),
        trigger: 'import',
        stats: result.stats || {},
        warnings: result.warnings || [],
        cancelled: result.stats?.cancelled === true,
      })
    } catch (err) {
      console.error('[observation auto-trigger] 执行失败:', err)
      const { storageRepository } = await import('./storageRepository.js')
      storageRepository.putMeta(OBSERVATION_SCAN_RESULT_META_KEY, {
        taskId,
        finishedAt: new Date().toISOString(),
        trigger: 'import',
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      stopHeartbeat?.()
    }
  })()

  return { triggered: true, taskId }
}
