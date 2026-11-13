import { describe, expect, it, vi } from 'vitest'
import { createInsightRefreshScheduler, nextBeijingFive } from './insightRefreshScheduler.js'

function timerHarness() {
  const timers = new Map()
  let nextId = 0
  return {
    setTimer(fn, delay) {
      const id = ++nextId
      timers.set(id, { fn, delay })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    fire(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay)
      expect(entry).toBeDefined()
      timers.delete(entry[0])
      entry[1].fn()
    },
  }
}

describe('insight refresh schedule', () => {
  it('runs at 05:00 Beijing time when the time has not arrived', () => {
    expect(nextBeijingFive(new Date('2026-11-11T20:59:59.000Z')).toISOString())
      .toBe('2026-11-11T21:00:00.000Z')
  })

  it('moves to the following Beijing day at exactly 05:00', () => {
    expect(nextBeijingFive(new Date('2026-11-11T21:00:00.000Z')).toISOString())
      .toBe('2026-11-12T21:00:00.000Z')
  })

  it('only starts at 05:00 and rebuilds saved periods one at a time', async () => {
    const timers = timerHarness()
    const calls = []
    let finish
    const completed = new Promise((resolve) => { finish = resolve })
    const scheduler = createInsightRefreshScheduler({
      ...timers,
      now: () => new Date('2026-11-11T20:59:59.000Z'),
      listTasks: () => [],
      listPeriods: () => [{ id: 'period-a' }, { id: 'period-b' }],
      enqueue: async (id) => {
        calls.push(id)
        return { job: { id } }
      },
      wait: async () => ({ status: 'succeeded' }),
      dirtyGeneration: () => 0,
      prune: () => finish(),
    })
    const stop = scheduler.start()
    expect(calls).toEqual([])
    timers.fire(1000)
    await completed
    expect(calls).toEqual(['period-a', 'period-b'])
    stop()
  })

  it('resumes the same period when a writing task interrupts the daily rebuild', async () => {
    const timers = timerHarness()
    let writing = true
    let finish
    const completed = new Promise((resolve) => { finish = resolve })
    const enqueue = vi.fn(async (id) => ({ job: { id } }))
    const scheduler = createInsightRefreshScheduler({
      ...timers,
      now: () => new Date('2026-11-11T20:59:59.000Z'),
      listTasks: () => writing ? [{ type: 'retag' }] : [],
      listPeriods: () => [{ id: 'period-a' }],
      enqueue,
      wait: async () => ({ status: 'succeeded' }),
      dirtyGeneration: () => 0,
      prune: () => finish(),
    })
    const stop = scheduler.start()
    timers.fire(1000)
    expect(enqueue).not.toHaveBeenCalled()
    writing = false
    timers.fire(15000)
    await completed
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith('period-a', 'system-05:00')
    stop()
  })

  it('does not skip a period when a task starts between the busy check and enqueue', async () => {
    const timers = timerHarness()
    let finish
    const completed = new Promise((resolve) => { finish = resolve })
    const busy = Object.assign(new Error('busy'), { code: 'INSIGHT_REBUILD_BUSY' })
    const enqueue = vi.fn()
      .mockRejectedValueOnce(busy)
      .mockResolvedValue({ job: { id: 'period-a' } })
    const scheduler = createInsightRefreshScheduler({
      ...timers,
      now: () => new Date('2026-11-11T20:59:59.000Z'),
      listTasks: () => [],
      listPeriods: () => [{ id: 'period-a' }],
      enqueue,
      wait: async () => ({ status: 'succeeded' }),
      dirtyGeneration: () => 0,
      prune: () => finish(),
    })
    const stop = scheduler.start()
    timers.fire(1000)
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => timers.fire(15000))
    await completed
    expect(enqueue).toHaveBeenCalledTimes(2)
    stop()
  })
})
