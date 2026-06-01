import { describe, expect, it, vi } from 'vitest'

vi.mock('./actionItemClient.js', () => ({
  unlinkTicketsFromActionLibrary: vi.fn(async (links) => ({ updated: links.length, items: [] })),
}))

import { unlinkTicketsFromActionLibrary } from './actionItemClient.js'
import { unlinkActionItemsForForceRetag } from './forceRetagActionUnlink.js'

describe('forceRetagActionUnlink', () => {
  it('collects unique actionId/ticketId pairs for force retag', async () => {
    const records = [
      { id: '1', ticketId: 'T-1', actionId: 'act-1' },
      { id: '2', ticketId: 'T-1', actionId: 'act-1' },
      { id: '3', ticketId: 'T-2', actionId: 'act-2' },
      { id: '4', ticketId: 'T-3', actionId: '' },
    ]
    const result = await unlinkActionItemsForForceRetag(records)
    expect(result.unlinked).toBe(2)
    expect(unlinkTicketsFromActionLibrary).toHaveBeenCalledWith([
      { actionId: 'act-1', ticketId: 'T-1' },
      { actionId: 'act-2', ticketId: 'T-2' },
    ])
  })

  it('returns zero when no linked records', async () => {
    const result = await unlinkActionItemsForForceRetag([{ id: '1', ticketId: 'T-1', actionId: '' }])
    expect(result.unlinked).toBe(0)
  })
})
