import { describe, expect, it } from 'vitest'
import {
  DELETE_TICKET_CONFIRM_PHRASE,
  matchesDeleteTicketConfirmPhrase,
} from './deleteTicketConfirm.js'

describe('deleteTicketConfirm', () => {
  it('accepts the exact confirmation phrase', () => {
    expect(DELETE_TICKET_CONFIRM_PHRASE).toBe('删除补录工单')
    expect(matchesDeleteTicketConfirmPhrase('删除补录工单')).toBe(true)
    expect(matchesDeleteTicketConfirmPhrase('  删除补录工单  ')).toBe(true)
  })

  it('rejects empty or mismatched input', () => {
    expect(matchesDeleteTicketConfirmPhrase('')).toBe(false)
    expect(matchesDeleteTicketConfirmPhrase('删除工单')).toBe(false)
    expect(matchesDeleteTicketConfirmPhrase('删除补录')).toBe(false)
  })
})
