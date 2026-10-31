import { describe, expect, it } from 'vitest'
import {
  TICKET_TODO_RESOLUTIONS,
  TICKET_TODO_RESOLUTION_LABELS,
  TICKET_TODO_PROCESS_MODE,
  resolveTicketTodoProcessResolution,
  applyTicketTodoResolutionToItem,
  lockTicketTodoResolution,
  isTicketTodoResolution,
} from './ticketTodo.js'

describe('ticketTodo converted_to_observation', () => {
  it('resolution enum/label include new state', () => {
    expect(TICKET_TODO_RESOLUTIONS).toContain('converted_to_observation')
    expect(TICKET_TODO_RESOLUTION_LABELS.converted_to_observation).toBe('已转留观')
    expect(isTicketTodoResolution('converted_to_observation')).toBe(true)
  })

  it('convert_observation mode: issueId required to resolve', () => {
    expect(
      resolveTicketTodoProcessResolution({
        processMode: TICKET_TODO_PROCESS_MODE.CONVERT_OBSERVATION,
        observationIssueId: 'issue-1',
      }),
    ).toBe('converted_to_observation')
    expect(
      resolveTicketTodoProcessResolution({
        processMode: TICKET_TODO_PROCESS_MODE.CONVERT_OBSERVATION,
      }),
    ).toBe('open')
  })

  it('legacy fallback unaffected', () => {
    expect(
      resolveTicketTodoProcessResolution({
        establishedActionContent: 'x',
      }),
    ).toBe('converted_to_action')
    expect(resolveTicketTodoProcessResolution({ markProcessed: true })).toBe(
      'processed_without_action',
    )
  })

  it('applyResolutionToItem persists linkedObservationIssueId and marks done', () => {
    const item = { id: 'i1', text: '跟进退订问题', resolution: 'open', done: false }
    const next = applyTicketTodoResolutionToItem(item, 'converted_to_observation', {
      linkedObservationIssueId: 'issue-9',
    })
    expect(next.resolution).toBe('converted_to_observation')
    expect(next.done).toBe(true)
    expect(next.linkedObservationIssueId).toBe('issue-9')
  })

  it('observation is a terminal state (lock)', () => {
    expect(lockTicketTodoResolution('converted_to_observation', 'open')).toBe(
      'converted_to_observation',
    )
    expect(lockTicketTodoResolution('open', 'converted_to_observation')).toBe(
      'converted_to_observation',
    )
  })
})
