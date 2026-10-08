import { describe, expect, it, beforeEach } from 'vitest'
import { buildAssistantLinkHref, buildAssistantCitationHref } from './assistantLinkBuilder.js'

beforeEach(() => {
  const store = new Map()
  const ss = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }
  Object.defineProperty(globalThis, 'sessionStorage', { value: ss, configurable: true })
})

describe('buildAssistantLinkHref', () => {
  it('builds workbench links with tab', () => {
    const href = buildAssistantLinkHref({ kind: 'workbench', params: { tab: 'complaint_ticket' } })
    expect(href).toContain('/workbench')
    expect(href).toContain('tab=complaint_ticket')
  })

  it('builds analysis links via buildWorkbenchAnalysisUrl', () => {
    const href = buildAssistantLinkHref({
      kind: 'analysis',
      params: { problemType: '问题类型', product: 'VPC' },
    })
    expect(href).toContain('/workbench/analysis')
    expect(href).toContain('problemType=')
    expect(href).toContain('product=VPC')
  })

  it('builds feedbacks links with comma-joined ticketIds under 20', () => {
    const href = buildAssistantLinkHref({
      kind: 'feedbacks',
      params: { source: 'complaint_ticket', ticketIds: ['T-1', 'T-2'] },
    })
    expect(href).toContain('/feedbacks')
    expect(href).toContain('source=complaint_ticket')
    expect(href).toContain('ticketIds=T-1%2CT-2')
  })

  it('writes a sessionStorage ticketIdSet when more than 20 ticketIds', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `T-${i}`)
    const href = buildAssistantLinkHref({
      kind: 'feedbacks',
      params: { source: 'complaint_ticket', ticketIds: ids },
    })
    expect(href).toContain('/feedbacks')
    expect(href).toContain('source=complaint_ticket')
    expect(href).toContain('ticketIdSet=')
    const setKey = href.match(/ticketIdSet=([^&]+)/)?.[1]
    expect(setKey).toBeTruthy()
    const stored = globalThis.sessionStorage.getItem(`feedbacks:ticketIdSet:${setKey}`)
    expect(stored).toBeTruthy()
    expect(stored).toContain('T-0')
    expect(stored).toContain('T-24')
  })

  it('forces source=post_use_rating for post-use links', () => {
    const href = buildAssistantLinkHref({
      kind: 'feedbacks',
      params: { source: 'post_use_rating', ticketIds: ['P-1'] },
    })
    expect(href).toContain('source=post_use_rating')
  })

  it('builds actions links with tab', () => {
    const href = buildAssistantLinkHref({ kind: 'actions', params: { tab: 'ticket-todos' } })
    expect(href).toContain('/actions')
    expect(href).toContain('tab=ticket-todos')
  })

  it('returns null for unknown kind', () => {
    expect(buildAssistantLinkHref({ kind: 'unknown', params: {} })).toBeNull()
  })
})

describe('buildAssistantCitationHref', () => {
  it('builds a feedbacks deep link with ticketId and source', () => {
    const href = buildAssistantCitationHref({ ticketId: 'C-123', dataSourceType: 'complaint_ticket' })
    expect(href).toContain('/feedbacks')
    expect(href).toContain('ticketId=C-123')
    expect(href).toContain('source=complaint_ticket')
  })

  it('forces source=post_use_rating for post-use citations', () => {
    const href = buildAssistantCitationHref({ ticketId: 'P-9', dataSourceType: 'post_use_rating' })
    expect(href).toContain('source=post_use_rating')
  })
})
