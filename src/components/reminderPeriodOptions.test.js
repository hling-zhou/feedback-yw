import { describe, expect, it } from 'vitest'
import { buildReminderPeriodOptions } from './reminderPeriodOptions.js'
import { LEGACY_INSIGHT_PERIOD_ID } from '../domain/constants.js'

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

function months(...pairs) {
  return pairs.map(([importMonth, count]) => ({ importMonth, count }))
}

describe('buildReminderPeriodOptions', () => {
  it('过滤 legacy 周期', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: LEGACY_INSIGHT_PERIOD_ID, label: '' }), period({ id: 'p1' })],
      months(['2026-07', 10]),
    )
    expect(options.map((o) => o.value)).toEqual(['p1'])
  })

  it('过滤无起始时间的周期', () => {
    const options = buildReminderPeriodOptions([period({ id: 'odd', startDate: '' })], null)
    expect(options).toEqual([])
  })

  it('覆盖数据月份的周期保留，无数据周期剔除', () => {
    const options = buildReminderPeriodOptions(
      [
        period({ id: 'm7' }),
        period({ id: 'm5', label: '2026年5月', startDate: '2026-05-01', endDate: '2026-05-31' }),
      ],
      months(['2026-07', 3]),
    )
    expect(options.map((o) => o.value)).toEqual(['m7'])
  })

  it('数据月份晚于当前自然月仍可选（不按自然时间截断）', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: 'future', label: '2026年11月', startDate: '2026-11-01', endDate: '2026-11-30' })],
      months(['2026-11', 5]),
    )
    expect(options.map((o) => o.value)).toEqual(['future'])
  })

  it('无数据月份的周期不再出现，有数据月份缺对象时补造保底', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: 'm10', label: '2026年10月', startDate: '2026-10-01', endDate: '2026-10-31' })],
      months(['2026-11', 5]),
    )
    // m10（2026年10月，无数据）被剔除；2026-11 有数据但缺周期对象，补造月选项保底可选
    expect(options).toEqual([{ value: 'period:month:2026-11', label: '2026年11月' }])
  })

  it('数据月份缺周期对象时补造月选项，未来数据月排最前', () => {
    const options = buildReminderPeriodOptions(
      [
        period({
          id: 'q3',
          label: '2026年Q3',
          startDate: '2026-07-01',
          endDate: '2026-09-30',
          granularity: 'quarter',
        }),
      ],
      months(['2026-07', 3], ['2026-11', 5]),
    )
    expect(options).toEqual([
      { value: 'period:month:2026-11', label: '2026年11月' },
      { value: 'q3', label: '2026年Q3' },
      { value: 'period:month:2026-07', label: '2026年7月' },
    ])
  })

  it('纯数据月份无任何周期对象时也能选出（全量补造）', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: LEGACY_INSIGHT_PERIOD_ID, label: '' })],
      months(['2026-06', 1]),
    )
    expect(options).toEqual([{ value: 'period:month:2026-06', label: '2026年6月' }])
  })

  it('已有同月周期对象时不重复补造，沿用对象 label 与归档后缀', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: 'period:month:2026-07', status: 'archived' })],
      months(['2026-07', 3]),
    )
    expect(options).toEqual([{ value: 'period:month:2026-07', label: '2026年7月（已归档）' }])
  })

  it('非规范 id 的月周期同样抑制补造', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: 'weird-july', label: '2026年7月' })],
      months(['2026-07', 3]),
    )
    expect(options).toEqual([{ value: 'weird-july', label: '2026年7月' }])
  })

  it('自定义周期按覆盖月份判定数据', () => {
    const options = buildReminderPeriodOptions(
      [
        period({
          id: 'period:custom:2026-05_2026-07',
          label: '2026年5月–7月',
          startDate: '2026-05-01',
          endDate: '2026-07-31',
          granularity: 'custom',
        }),
      ],
      months(['2026-06', 10]),
    )
    expect(options).toEqual([
      { value: 'period:month:2026-06', label: '2026年6月' },
      { value: 'period:custom:2026-05_2026-07', label: '2026年5月–7月' },
    ])
  })

  it('月聚合不可用（null）时不按数据过滤、不补造，仅排除 legacy', () => {
    const options = buildReminderPeriodOptions(
      [
        period({ id: 'm7' }),
        period({ id: 'm12', label: '2026年12月', startDate: '2026-12-01', endDate: '2026-12-31' }),
      ],
      null,
    )
    expect(options.map((o) => o.value)).toEqual(['m12', 'm7'])
  })

  it('count 为 0 的月份不算有数据', () => {
    const options = buildReminderPeriodOptions([period({ id: 'm7' })], months(['2026-07', 0]))
    expect(options).toEqual([])
  })

  it('按起始时间倒序，同起始时结束晚者在前（季度排在月之前）', () => {
    const options = buildReminderPeriodOptions(
      [
        period({ id: 'm7' }),
        period({
          id: 'q3',
          label: '2026年Q3',
          startDate: '2026-07-01',
          endDate: '2026-09-30',
          granularity: 'quarter',
        }),
        period({ id: 'm8', label: '2026年8月', startDate: '2026-08-01', endDate: '2026-08-31' }),
      ],
      null,
    )
    expect(options.map((o) => o.value)).toEqual(['m8', 'q3', 'm7'])
  })

  it('label 优先周期自带 label，缺省时回退起止区间', () => {
    const options = buildReminderPeriodOptions(
      [period({ id: 'no-label', label: '', startDate: '2026-05-01', endDate: '2026-05-31' })],
      null,
    )
    expect(options[0].label).toBe('2026-05-01 ~ 2026-05-31')
  })

  it('缺 endDate 时 label 回退起始日期', () => {
    const options = buildReminderPeriodOptions([period({ id: 'no-end', label: '', endDate: '' })], null)
    expect(options[0].label).toBe('2026-07-01')
  })

  it('归档周期追加「（已归档）」后缀', () => {
    const options = buildReminderPeriodOptions([period({ id: 'arch', status: 'archived' })], null)
    expect(options[0].label).toBe('2026年7月（已归档）')
  })

  it('同 id 重复周期只保留排序后的第一条', () => {
    const options = buildReminderPeriodOptions(
      [
        period({ id: 'dup', label: '2026年6月', startDate: '2026-06-01', endDate: '2026-06-30' }),
        period({ id: 'dup', label: '2026年6月', startDate: '2026-06-01', endDate: '2026-06-30' }),
        period({ id: 'm9', label: '2026年9月', startDate: '2026-09-01', endDate: '2026-09-30' }),
      ],
      null,
    )
    expect(options.map((o) => o.value)).toEqual(['m9', 'dup'])
  })

  it('非数组入参返回空数组', () => {
    expect(buildReminderPeriodOptions(null, months(['2026-07', 1]))).toEqual([])
    expect(buildReminderPeriodOptions(undefined)).toEqual([])
  })
})
