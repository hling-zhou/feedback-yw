import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FEEDBACK_TICKET_ID_SET_PARAM,
  FEEDBACK_TICKET_ID_URL_LIMIT,
  clearFeedbackTicketIdSet,
  formatClusterEvidenceLinkLabel,
  formatClusterTicketSetChipLabel,
  readFeedbackTicketIdSet,
  resolveClusterFeedbacksNavigation,
  writeFeedbackTicketIdSet,
} from './feedbackTicketIdSet.js'

describe('feedbackTicketIdSet', () => {
  beforeEach(() => {
    const store = new Map()
    globalThis.sessionStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
    }
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('keeps small clusters in the ticketIds query string', () => {
    const ids = Array.from({ length: FEEDBACK_TICKET_ID_URL_LIMIT }, (_, index) => `T-${index + 1}`)
    const nav = resolveClusterFeedbacksNavigation({
      sourceType: 'complaint_ticket',
      ticketIds: ids,
      ticketCount: ids.length,
    })
    expect(nav.usesSession).toBe(false)
    expect(nav.href).toContain('ticketIds=T-1')
    expect(nav.href).not.toContain(`${FEEDBACK_TICKET_ID_SET_PARAM}=`)
  })

  it('stores large clusters in session storage instead of the URL', () => {
    const ids = Array.from({ length: FEEDBACK_TICKET_ID_URL_LIMIT + 1 }, (_, index) => `T-${index + 1}`)
    const nav = resolveClusterFeedbacksNavigation({
      sourceType: 'consultation_ticket',
      ticketIds: ids,
      ticketCount: 248,
    })
    expect(nav.usesSession).toBe(true)
    expect(nav.href).not.toContain('ticketIds=')
    const params = new URLSearchParams(nav.href.split('?')[1] || '')
    const setId = params.get(FEEDBACK_TICKET_ID_SET_PARAM)
    expect(setId).toBeTruthy()
    expect(params.get('source')).toBe('consultation_ticket')
    expect(readFeedbackTicketIdSet(setId)).toEqual({
      ticketIds: ids,
      label: '主题依据 21 条',
    })
  })

  it('clears a stored ticket id set', () => {
    const setId = writeFeedbackTicketIdSet(['A', 'B'], { label: '主题依据 2 条' })
    clearFeedbackTicketIdSet(setId)
    expect(readFeedbackTicketIdSet(setId)).toBeNull()
  })

  it('formats the cluster evidence link from cluster size', () => {
    expect(formatClusterEvidenceLinkLabel(248)).toBe('查看簇内 248 条')
    expect(formatClusterEvidenceLinkLabel(0)).toBe('查看簇内工单')
  })

  it('shows filter count and library match count on the feedbacks chip', () => {
    expect(formatClusterTicketSetChipLabel(248, 240)).toBe('筛选 248 / 库内匹配 240')
    expect(formatClusterTicketSetChipLabel(21, 0)).toBe('筛选 21 / 库内匹配 0')
  })
})
