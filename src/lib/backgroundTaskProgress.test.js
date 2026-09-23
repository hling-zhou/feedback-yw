import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_TASK_PROGRESS_THROTTLE_MS,
  shouldPublishBackgroundTaskProgress,
} from './backgroundTaskProgress.js'

describe('shouldPublishBackgroundTaskProgress', () => {
  it('publishes the first progress text', () => {
    expect(shouldPublishBackgroundTaskProgress(null, '正在准备分析…', 1000)).toBe(true)
  })

  it('publishes immediately when the phase changes', () => {
    expect(
      shouldPublishBackgroundTaskProgress(
        { text: '正在准备分析…', at: 1000 },
        '正在规则打标 (1/10)…',
        1100,
      ),
    ).toBe(true)
  })

  it('throttles count-only updates within the same phase', () => {
    expect(
      shouldPublishBackgroundTaskProgress(
        { text: '正在规则打标 (1/10)…', at: 1000 },
        '正在规则打标 (2/10)…',
        1000 + BACKGROUND_TASK_PROGRESS_THROTTLE_MS - 1,
      ),
    ).toBe(false)
    expect(
      shouldPublishBackgroundTaskProgress(
        { text: '正在规则打标 (1/10)…', at: 1000 },
        '正在规则打标 (2/10)…',
        1000 + BACKGROUND_TASK_PROGRESS_THROTTLE_MS,
      ),
    ).toBe(true)
  })
})
