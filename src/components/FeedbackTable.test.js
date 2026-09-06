import { describe, expect, it } from 'vitest'
import { filterVisibleColumns } from './FeedbackTable.jsx'

const COLUMNS = [
  { title: '工单', dataIndex: 'ticketId' },
  { title: '请求场景', dataIndex: 'requestScene' },
  { title: '问题类型', dataIndex: 'problemType' },
  { title: '用户旅程', dataIndex: 'journeyL1' },
  { title: '资源池', dataIndex: 'resourcePool' },
]

describe('filterVisibleColumns', () => {
  it('returns all columns when hiddenColumns is undefined', () => {
    expect(filterVisibleColumns(COLUMNS, undefined)).toHaveLength(5)
  })

  it('returns all columns when hidden set is empty', () => {
    expect(filterVisibleColumns(COLUMNS, new Set())).toHaveLength(5)
    expect(filterVisibleColumns(COLUMNS, [])).toHaveLength(5)
  })

  it('hides the four default columns when given as a Set', () => {
    const hidden = new Set(['requestScene', 'problemType', 'journeyL1', 'resourcePool'])
    const visible = filterVisibleColumns(COLUMNS, hidden)
    expect(visible.map((c) => c.dataIndex)).toEqual(['ticketId'])
  })

  it('accepts an array of hidden keys', () => {
    const visible = filterVisibleColumns(COLUMNS, ['requestScene', 'problemType'])
    expect(visible.map((c) => c.dataIndex)).toEqual(['ticketId', 'journeyL1', 'resourcePool'])
  })

  it('ignores unknown hidden keys', () => {
    const visible = filterVisibleColumns(COLUMNS, ['doesNotExist'])
    expect(visible).toHaveLength(5)
  })
})
