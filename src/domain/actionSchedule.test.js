import { describe, expect, it } from 'vitest'
import { recordToExportRowV2 } from '../lib/ticketAnalysisExport.js'
import {
  ACTION_SCHEDULE_MAX_LENGTH,
  buildActionScheduleSavePatch,
  getActionScheduleDisplay,
  normalizeActionSchedule,
} from './actionSchedule.js'

describe('actionSchedule', () => {
  it('normalizeActionSchedule trims and allows empty (R1)', () => {
    expect(normalizeActionSchedule('  2026-08-01  ')).toBe('2026-08-01')
    expect(normalizeActionSchedule('')).toBe('')
    expect(normalizeActionSchedule('   ')).toBe('')
  })

  it('normalizeActionSchedule caps length', () => {
    expect(normalizeActionSchedule('x'.repeat(ACTION_SCHEDULE_MAX_LENGTH + 5)).length).toBe(
      ACTION_SCHEDULE_MAX_LENGTH,
    )
  })

  it('getActionScheduleDisplay shows 待评估 when empty', () => {
    expect(getActionScheduleDisplay('')).toBe('待评估')
    expect(getActionScheduleDisplay('2026-09-01')).toBe('2026-09-01')
  })

  it('buildActionScheduleSavePatch normalizes value', () => {
    expect(buildActionScheduleSavePatch(' 2026-07-15 ')).toEqual({
      actionSchedule: '2026-07-15',
    })
    expect(buildActionScheduleSavePatch('')).toEqual({ actionSchedule: '' })
  })

  it('empty schedule exports empty 排期 cell', () => {
    const row = recordToExportRowV2({
      id: '1',
      ticketId: 'T-1',
      actionSchedule: '',
      establishedAction: '举措',
    })
    expect(row['排期']).toBe('')
  })

  it('non-empty schedule exports to 排期 column', () => {
    const row = recordToExportRowV2({
      id: '1',
      ticketId: 'T-1',
      actionSchedule: '2026-08-15',
      establishedAction: '举措',
    })
    expect(row['排期']).toBe('2026-08-15')
  })
})
