import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HANDLING_EXPAND_WHATS_NEW_KEY,
  WORKBENCH_TICKET_TABS_WHATS_NEW_KEY,
  hasSeenHandlingExpandWhatsNew,
  hasSeenWhatsNew,
  hasSeenWorkbenchTicketTabsWhatsNew,
  markHandlingExpandWhatsNewSeen,
  markWhatsNewSeen,
  markWorkbenchTicketTabsWhatsNewSeen,
} from './whatsNew.js'

describe('whatsNew', () => {
  /** @type {Map<string, string>} */
  let store

  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        store.set(String(key), String(value))
      },
      removeItem: (key) => {
        store.delete(String(key))
      },
    })
  })

  it('tracks generic keys', () => {
    expect(hasSeenWhatsNew('fi.test.v1')).toBe(false)
    markWhatsNewSeen('fi.test.v1')
    expect(hasSeenWhatsNew('fi.test.v1')).toBe(true)
    expect(store.get('fi.test.v1')).toBe('1')
  })

  it('tracks handling expand and workbench ticket tab keys', () => {
    expect(hasSeenHandlingExpandWhatsNew()).toBe(false)
    markHandlingExpandWhatsNewSeen()
    expect(hasSeenHandlingExpandWhatsNew()).toBe(true)
    expect(store.get(HANDLING_EXPAND_WHATS_NEW_KEY)).toBe('1')

    expect(hasSeenWorkbenchTicketTabsWhatsNew()).toBe(false)
    markWorkbenchTicketTabsWhatsNewSeen()
    expect(hasSeenWorkbenchTicketTabsWhatsNew()).toBe(true)
    expect(store.get(WORKBENCH_TICKET_TABS_WHATS_NEW_KEY)).toBe('1')
  })
})
