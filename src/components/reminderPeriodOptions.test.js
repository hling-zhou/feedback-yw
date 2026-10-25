import { describe, expect, it } from 'vitest'
import { buildReminderPeriodOptions } from './reminderPeriodOptions.js'
import { LEGACY_INSIGHT_PERIOD_ID } from '../domain/constants.js'

const NOW = new Date('2026-10-25T12:00:00')

function period(overrides = {}) {
  return {
    id: 'p',
    label: '2026年7月',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    granularity: 'month',
    status: 'active',
    ...overrides,
  }
}

describe('buildReminderPeriodOptions', () => {
  it('过滤 legacy 周期', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: LEGACY_INSIGHT_PERIOD_ID, label: '' }), period({ id: 'p1' })],
      NOW,
    )
    expect(options.map((o) => o.value)).toEqual(['p1'])
  })

  it('过滤未来周期，保留当天开始的周期', () => {
    const options = buildReminderPeriodOptions(
      [
        period({ id: 'past' }),
        period({ id: 'future', label: '2026年11月', startDate: '2026-11-01', endDate: '2026-11-30' }),
        period({ id: 'today-start', label: '2026年10月', startDate: '2026-10-01', endDate: '2026-10-31' }),
      ],
      NOW,
    )
    expect(options.map((o) => o.value)).toEqual(['today-start', 'past'])
  })

  it('过滤无起始时间的周期', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: 'odd', startDate: '' })],
      NOW,
    )
    expect(options).toEqual([])
  })

  it('按起始时间倒序，同起始时结束晚者在前（季度排在月之前）', () => {
    const options = buildReminderPeriodOptions(
      [
        period({ id: 'm7' }),
        period({ id: 'q3', label: '2026年Q3', startDate: '2026-07-01', endDate: '2026-09-30', granularity: 'quarter' }),
        period({ id: 'm8', label: '2026年8月', startDate: '2026-08-01', endDate: '2026-08-31' }),
      ],
      NOW,
    )
    expect(options.map((o) => o.value)).toEqual(['m8', 'q3', 'm7'])
  })

  it('label 优先周期自带 label，缺省时回退起止区间', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: 'no-label', label: '', startDate: '2026-05-01', endDate: '2026-05-31' })],
      NOW,
    )
    expect(options[0].label).toBe('2026-05-01 ~ 2026-05-31')
  })

  it('缺 endDate 时 label 回退起始日期', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: 'no-end', label: '', endDate: '' })],
      NOW,
    )
    expect(options[0].label).toBe('2026-07-01')
  })

  it('归档周期追加「（已归档）」后缀', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: 'arch', status: 'archived' })],
      NOW,
    )
    expect(options[0].label).toBe('2026年7月（已归档）')
  })

  it('同 id 重复周期只保留排序后的第一条', () => {
    const options = buildReminderPeriodOptions(
      [
        period({ id: 'dup', label: '2026年6月', startDate: '2026-06-01', endDate: '2026-06-30' }),
        period({ id: 'dup', label: '2026年6月', startDate: '2026-06-01', endDate: '2026-06-30' }),
        period({ id: 'm9', label: '2026年9月', startDate: '2026-09-01', endDate: '2026-09-30' }),
      ],
      NOW,
    )
    expect(options.map((o) => o.value)).toEqual(['m9', 'dup'])
  })

  it('非数组入参返回空数组', () => {
    expect(buildReminderPeriodOptions(null, NOW)).toEqual([])
    expect(buildReminderPeriodOptions(undefined, NOW)).toEqual([])
  })
})
