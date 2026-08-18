import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('DeleteTicketConfirmModal', () => {
  const src = readFileSync(resolve(import.meta.dirname, 'DeleteTicketConfirmModal.jsx'), 'utf8')

  it('requires pasting the confirmation phrase before submit', () => {
    expect(src).toContain('DELETE_TICKET_CONFIRM_PHRASE')
    expect(src).toContain('matchesDeleteTicketConfirmPhrase')
    expect(src).toContain('okText="确定"')
    expect(src).toContain('disabled: !matched')
    expect(src).toContain('copyable')
  })
})
