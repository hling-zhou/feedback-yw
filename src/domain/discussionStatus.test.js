import { describe, expect, it } from 'vitest'
import {
  DISCUSSION_STATUSES,
  DISCUSSION_STATUS_LABELS,
  matchesDiscussionStatusFilter,
  mergeDiscussionStatus,
  normalizeDiscussionStatus,
  normalizeDiscussionStatusFilter,
} from './discussionStatus.js'

describe('discussionStatus 域模块（三态单向，2026-11-25 拍板）', () => {
  it('normalize：合法值透传，undefined/空/非法归一为未标记', () => {
    expect(normalizeDiscussionStatus('pending')).toBe('pending')
    expect(normalizeDiscussionStatus('done')).toBe('done')
    expect(normalizeDiscussionStatus('')).toBe('')
    expect(normalizeDiscussionStatus(undefined)).toBe('')
    expect(normalizeDiscussionStatus(null)).toBe('')
    expect(normalizeDiscussionStatus('garbage')).toBe('')
    expect(normalizeDiscussionStatus(' pending ')).toBe('pending')
  })

  it('merge 闩锁：取更深者，任何写入路径不可回退（跨用户）', () => {
    // 正向推进
    expect(mergeDiscussionStatus('', 'pending')).toBe('pending')
    expect(mergeDiscussionStatus('pending', 'done')).toBe('done')
    expect(mergeDiscussionStatus('', 'done')).toBe('done')
    // 回退被拦（核心：已落库的深度不可被任何写入清掉）
    expect(mergeDiscussionStatus('done', 'pending')).toBe('done')
    expect(mergeDiscussionStatus('done', '')).toBe('done')
    expect(mergeDiscussionStatus('done', undefined)).toBe('done')
    expect(mergeDiscussionStatus('pending', '')).toBe('pending')
    expect(mergeDiscussionStatus('pending', 'garbage')).toBe('pending')
    // 同档不变
    expect(mergeDiscussionStatus('pending', 'pending')).toBe('pending')
    expect(mergeDiscussionStatus('done', 'done')).toBe('done')
    // 双未标记
    expect(mergeDiscussionStatus(undefined, null)).toBe('')
  })

  it('matches：四态筛选匹配（none 兜住老数据 undefined）', () => {
    expect(matchesDiscussionStatusFilter({ discussionStatus: 'pending' }, 'pending')).toBe(true)
    expect(matchesDiscussionStatusFilter({ discussionStatus: 'done' }, 'pending')).toBe(false)
    expect(matchesDiscussionStatusFilter({ discussionStatus: 'done' }, 'done')).toBe(true)
    // 老数据 undefined → 未标记
    expect(matchesDiscussionStatusFilter({}, 'none')).toBe(true)
    expect(matchesDiscussionStatusFilter({ discussionStatus: '' }, 'none')).toBe(true)
    expect(matchesDiscussionStatusFilter({ discussionStatus: 'pending' }, 'none')).toBe(false)
    // 全部恒真
    expect(matchesDiscussionStatusFilter({}, '')).toBe(true)
    expect(matchesDiscussionStatusFilter({ discussionStatus: 'done' }, '')).toBe(true)
  })

  it('filter 归一：非法/未知值回退全部（旧书签兼容）', () => {
    expect(normalizeDiscussionStatusFilter('none')).toBe('none')
    expect(normalizeDiscussionStatusFilter('pending')).toBe('pending')
    expect(normalizeDiscussionStatusFilter('done')).toBe('done')
    expect(normalizeDiscussionStatusFilter('')).toBe('')
    expect(normalizeDiscussionStatusFilter(undefined)).toBe('')
    expect(normalizeDiscussionStatusFilter('xxx')).toBe('')
  })

  it('标签与常量单源（Tag/筛选/列表共用）', () => {
    expect(DISCUSSION_STATUS_LABELS['']).toBe('未标记')
    expect(DISCUSSION_STATUS_LABELS.pending).toBe('待讨论')
    expect(DISCUSSION_STATUS_LABELS.done).toBe('已讨论')
    expect(DISCUSSION_STATUSES).toEqual(['', 'pending', 'done'])
  })
})
