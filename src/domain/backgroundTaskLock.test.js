import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_TASK_MAX_AGE_MS,
  BACKGROUND_TASK_STALE_MS,
  formatBackgroundTaskBlockedTip,
  formatBackgroundTaskRemoteBanner,
  isBackgroundTaskLockActive,
  isBackgroundTaskLockHeldByUser,
  isBackgroundTaskLockStale,
} from './backgroundTaskLock.js'

const sampleLock = {
  id: 'lock-1',
  type: /** @type {const} */ ('retag'),
  userId: 'user-a',
  username: 'alice',
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  progress: 'LLM 增强 (3/10)',
  meta: { total: 10, scope: 'needs_ticket_llm' },
}

describe('backgroundTaskLock domain', () => {
  it('detects active lock within stale window', () => {
    const now = Date.parse(sampleLock.updatedAt) + 1000
    expect(isBackgroundTaskLockActive(sampleLock, now)).toBe(true)
    expect(isBackgroundTaskLockStale(sampleLock, now)).toBe(false)
  })

  it('treats lock as stale after heartbeat timeout', () => {
    const now = Date.parse(sampleLock.updatedAt) + BACKGROUND_TASK_STALE_MS + 1
    expect(isBackgroundTaskLockStale(sampleLock, now)).toBe(true)
    expect(isBackgroundTaskLockActive(sampleLock, now)).toBe(false)
  })

  it('treats lock as expired after max age', () => {
    const now = Date.parse(sampleLock.startedAt) + BACKGROUND_TASK_MAX_AGE_MS + 1
    expect(isBackgroundTaskLockActive(sampleLock, now)).toBe(false)
  })

  it('formats blocked tip and remote banner', () => {
    expect(formatBackgroundTaskBlockedTip(sampleLock)).toContain('alice')
    expect(formatBackgroundTaskBlockedTip({ ...sampleLock, type: 'import' })).toContain('数据导入')
    expect(formatBackgroundTaskBlockedTip({ ...sampleLock, type: 'pdf_export' })).toContain('PDF')
    expect(formatBackgroundTaskRemoteBanner(sampleLock)).toContain('批量重新打标')
    expect(
      formatBackgroundTaskRemoteBanner({
        ...sampleLock,
        type: 'pdf_export',
        meta: { label: '投诉工单报告' },
        progress: '正在截取图表',
      }),
    ).toContain('PDF')
    expect(isBackgroundTaskLockHeldByUser(sampleLock, 'user-a')).toBe(true)
    expect(isBackgroundTaskLockHeldByUser(sampleLock, 'user-b')).toBe(false)
  })
})
