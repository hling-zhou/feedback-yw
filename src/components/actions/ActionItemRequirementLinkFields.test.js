import { describe, expect, it } from 'vitest'
import {
  normalizeRequirementTicketIdsFromForm,
  toRequirementTicketFormList,
} from './ActionItemRequirementLinkFields.jsx'

describe('ActionItemRequirementLinkFields helpers', () => {
  it('normalizes and deduplicates ticket ids from form list', () => {
    expect(normalizeRequirementTicketIdsFromForm([' REQ-1 ', 'REQ-2', 'REQ-1', ''])).toEqual([
      'REQ-1',
      'REQ-2',
    ])
  })

  it('toRequirementTicketFormList returns one empty row when no ids', () => {
    expect(toRequirementTicketFormList([])).toEqual([''])
    expect(toRequirementTicketFormList(['REQ-1', 'REQ-2'])).toEqual(['REQ-1', 'REQ-2'])
  })
})
