import { describe, it, expect, beforeEach } from 'vitest'
import { subscribe, emit, resetEventBus } from './events.js'

describe('EventBus', () => {
  beforeEach(() => {
    resetEventBus()
  })

  it('delivers events to subscribers', () => {
    /** @type {string[]} */
    const received = []
    subscribe('SnapshotBuilt', (ev) => {
      received.push(ev.type)
    })
    emit('SnapshotBuilt', { periodId: 'p1' })
    expect(received).toEqual(['SnapshotBuilt'])
  })

  it('unsubscribe stops delivery', () => {
    let count = 0
    const off = subscribe('ImportCompleted', () => {
      count += 1
    })
    emit('ImportCompleted')
    off()
    emit('ImportCompleted')
    expect(count).toBe(1)
  })
})
