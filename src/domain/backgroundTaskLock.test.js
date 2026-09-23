import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_TASK_MAX_AGE_MS,
  BACKGROUND_TASK_PHASE_CLIENT,
  BACKGROUND_TASK_PHASE_ENRICH,
  BACKGROUND_TASK_STALE_MS,
  formatBackgroundTaskBlockedTip,
  formatBackgroundTaskRemoteBanner,
  formatOwnedBackgroundTaskBanner,
  backgroundTasksConflict,
  importSessionConflicts,
  retagStartConflict,
  isBackgroundTaskCancelRequested,
  isBackgroundTaskEnrichPhase,
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
    expect(formatBackgroundTaskRemoteBanner(sampleLock)).toContain('批量重新打标')
    expect(isBackgroundTaskLockHeldByUser(sampleLock, 'user-a')).toBe(true)
    expect(isBackgroundTaskLockHeldByUser(sampleLock, 'user-b')).toBe(false)
  })

  it('conflicts only for the same import month and source, or a retag covering that month', () => {
    const marchImport = {
      id: 'a',
      type: /** @type {const} */ ('import'),
      userId: 'u',
      username: 'a',
      startedAt: sampleLock.startedAt,
      updatedAt: sampleLock.updatedAt,
      meta: { dataMonth: '2026-03', dataSourceType: 'complaint_ticket' },
    }
    expect(
      backgroundTasksConflict(marchImport, {
        type: 'import',
        meta: { dataMonth: '2026-03', dataSourceType: 'complaint_ticket' },
      }),
    ).toBe(true)
    expect(
      backgroundTasksConflict(marchImport, {
        type: 'import',
        meta: { dataMonth: '2026-04', dataSourceType: 'complaint_ticket' },
      }),
    ).toBe(false)
    expect(
      backgroundTasksConflict(
        {
          ...sampleLock,
          meta: { periodId: 'p1', periodStart: '2026-03-01', periodEnd: '2026-03-31' },
        },
        { type: 'import', meta: { dataMonth: '2026-03', dataSourceType: 'complaint_ticket' } },
      ),
    ).toBe(true)
    expect(
      backgroundTasksConflict(
        {
          ...sampleLock,
          meta: { periodId: 'p1', periodStart: '2026-03-01', periodEnd: '2026-03-31' },
        },
        { type: 'import', meta: { dataMonth: '2026-03', dataSourceType: 'post_use_rating' } },
      ),
    ).toBe(false)
  })

  it('does not let an August consultation session block a September complaint import', () => {
    const augustConsultation = {
      active: true,
      dataMonth: '2026-08',
      dataSourceType: 'consultation_ticket',
    }
    expect(
      importSessionConflicts(augustConsultation, {
        dataMonth: '2026-09',
        dataSourceType: 'complaint_ticket',
      }),
    ).toBe(false)
    expect(
      importSessionConflicts(augustConsultation, {
        dataMonth: '2026-08',
        dataSourceType: 'complaint_ticket',
      }),
    ).toBe(false)
    expect(
      importSessionConflicts(augustConsultation, {
        dataMonth: '2026-08',
        dataSourceType: 'consultation_ticket',
      }),
    ).toBe(true)
    expect(
      importSessionConflicts(
        { active: true, dataMonth: '2026-08' },
        { dataMonth: '2026-09', dataSourceType: 'complaint_ticket' },
      ),
    ).toBe(false)
  })

  it('blocks retag only for an overlapping ticket import or the same period', () => {
    const september = {
      periodId: '2026-09',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    }
    const august = {
      periodId: '2026-08',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    }
    expect(
      retagStartConflict(
        { active: true, dataMonth: '2026-08', dataSourceType: 'consultation_ticket' },
        { active: false },
        september,
      ),
    ).toBe(null)
    expect(
      retagStartConflict(
        { active: true, dataMonth: '2026-09', dataSourceType: 'post_use_rating' },
        { active: false },
        september,
      ),
    ).toBe(null)
    expect(
      retagStartConflict(
        { active: true, dataMonth: '2026-09', dataSourceType: 'complaint_ticket' },
        { active: false },
        september,
      ),
    ).toBe('import')
    const augustRetag = {
      active: true,
      periodId: '2026-08',
      runs: [{ periodId: '2026-08', periodStart: '2026-08-01', periodEnd: '2026-08-31' }],
    }
    expect(retagStartConflict({ active: false }, augustRetag, september)).toBe(null)
    expect(retagStartConflict({ active: false }, augustRetag, august)).toBe('retag')
  })

  it('formats owned banner and detects enrich / cancel state', () => {
    expect(
      formatOwnedBackgroundTaskBanner({
        ...sampleLock,
        type: 'import',
        progress: '正在规则打标 (12/300)…',
        meta: { dataMonth: '2026-08' },
      }),
    ).toBe('正在规则打标 (12/300)… · 数据月份 2026-08')
    expect(isBackgroundTaskEnrichPhase({ ...sampleLock, meta: { phase: BACKGROUND_TASK_PHASE_ENRICH } })).toBe(
      true,
    )
    expect(isBackgroundTaskEnrichPhase({ ...sampleLock, meta: { phase: BACKGROUND_TASK_PHASE_CLIENT } })).toBe(
      false,
    )
    expect(isBackgroundTaskCancelRequested({ ...sampleLock, meta: { cancelled: true } })).toBe(true)
  })
})
