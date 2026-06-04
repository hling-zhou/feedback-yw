import { describe, expect, it } from 'vitest'
import { computeActionItemWarningLevel, daysBetweenDates } from './actionItemWarning.js'
import { validateActionItemCreate } from './actionItem.js'

describe('actionItemWarning', () => {
  const today = new Date(2026, 5, 1) // 2026-06-01

  it('pending_evaluation: orange at 15d, red at 30d', () => {
    const base = validateActionItemCreate({
      content: '举措',
      firstProposedAt: '2026-05-01',
      scheduleAt: '',
    })

    expect(base.ok).toBe(true)
    if (!base.ok) return

    expect(computeActionItemWarningLevel(base.item, today)).toBe('red')

    const orangeItem = { ...base.item, firstProposedAt: '2026-05-17' }
    expect(computeActionItemWarningLevel(orangeItem, today)).toBe('orange')

    const redItem = { ...base.item, firstProposedAt: '2026-04-20' }
    expect(computeActionItemWarningLevel(redItem, today)).toBe('red')

    const safeItem = { ...base.item, firstProposedAt: '2026-05-20' }
    expect(computeActionItemWarningLevel(safeItem, today)).toBe('none')
  })

  it('in_progress: orange within 15d of schedule, red after due', () => {
    const created = validateActionItemCreate({
      content: '举措',
      scheduleAt: '2026-06-10',
      status: 'in_progress',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(computeActionItemWarningLevel(created.item, today)).toBe('orange')

    const overdue = { ...created.item, scheduleAt: '2026-05-20' }
    expect(computeActionItemWarningLevel(overdue, today)).toBe('red')

    const far = { ...created.item, scheduleAt: '2026-07-01' }
    expect(computeActionItemWarningLevel(far, today)).toBe('none')
  })

  it('not_implemented and abnormal_terminated have no warning', () => {
    const created = validateActionItemCreate({
      content: '举措',
      firstProposedAt: '2026-01-01',
      scheduleAt: '2026-01-01',
      status: 'in_progress',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(
      computeActionItemWarningLevel({ ...created.item, status: 'not_implemented' }, today),
    ).toBe('none')
    expect(
      computeActionItemWarningLevel({ ...created.item, status: 'abnormal_terminated' }, today),
    ).toBe('none')
  })

  it('completed and suspended have no warning', () => {
    const created = validateActionItemCreate({
      content: '举措',
      firstProposedAt: '2026-01-01',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(
      computeActionItemWarningLevel({ ...created.item, status: 'completed' }, today),
    ).toBe('none')
    expect(
      computeActionItemWarningLevel({ ...created.item, status: 'suspended' }, today),
    ).toBe('none')
  })

  it('daysBetweenDates counts whole days', () => {
    const a = new Date(2026, 0, 1)
    const b = new Date(2026, 0, 16)
    expect(daysBetweenDates(a, b)).toBe(15)
  })
})
