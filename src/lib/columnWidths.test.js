import { describe, expect, it } from 'vitest'
import {
  MIN_COLUMN_WIDTH,
  applyColumnWidths,
  buildTableWidthStorageKey,
  clampColumnWidth,
  clearColumnWidths,
  columnIdentityKey,
  isResizableColumn,
  loadColumnWidths,
  saveColumnWidths,
  sumColumnsWidth,
} from './columnWidths.js'

/** 模拟 localStorage（node 环境无 DOM） */
/** @returns {any} duck-typing mock，仅 getItem/setItem/removeItem */
function makeMemoryStorage() {
  /** @type {Record<string, string>} */
  const data = {}
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
    removeItem: (k) => {
      delete data[k]
    },
    get __data() {
      return data
    },
  }
}

/** @type {any[]} */
const COLUMNS = [
  { title: '数据月份', dataIndex: 'importMonth', width: 90 },
  { title: '客户名称', dataIndex: 'customerName', width: 150, fixed: 'left' },
  { title: '客户反馈', dataIndex: 'customerFeedback' }, // 弹性列（无 width）
  { title: '操作', key: 'actions', width: 56 },
  { title: '状态', dataIndex: 'status', width: 90 },
]

describe('isResizableColumn', () => {
  it('普通带 width 列可拖', () => {
    expect(isResizableColumn(COLUMNS[0])).toBe(true)
    expect(isResizableColumn(COLUMNS[4])).toBe(true)
  })

  it('fixed 列不可拖', () => {
    expect(isResizableColumn({ title: '工单', dataIndex: 'ticketId', width: 180, fixed: 'left' })).toBe(false)
    expect(isResizableColumn({ title: '操作', key: '__deleteAction', width: 56, fixed: 'right' })).toBe(false)
  })

  it('操作列（actions/__deleteAction）不可拖，即使无 fixed', () => {
    expect(isResizableColumn({ title: '操作', key: 'actions', width: 56 })).toBe(false)
    expect(isResizableColumn({ title: '操作', key: '__deleteAction', width: 56 })).toBe(false)
  })

  it('无 width 弹性列不可拖', () => {
    expect(isResizableColumn({ title: '客户反馈', dataIndex: 'customerFeedback', ellipsis: true })).toBe(false)
  })

  it('非法 width（0/负数/NaN/字符串）不可拖', () => {
    expect(isResizableColumn({ dataIndex: 'a', width: 0 })).toBe(false)
    expect(isResizableColumn({ dataIndex: 'b', width: -10 })).toBe(false)
    expect(isResizableColumn({ dataIndex: 'c', width: Number.NaN })).toBe(false)
    expect(isResizableColumn({ dataIndex: 'd', width: '120' })).toBe(false)
  })

  it('null/undefined 列不可拖', () => {
    expect(isResizableColumn(null)).toBe(false)
    expect(isResizableColumn(undefined)).toBe(false)
  })
})

describe('columnIdentityKey', () => {
  it('优先 dataIndex，其次 key', () => {
    expect(columnIdentityKey({ dataIndex: 'status', key: 'k1' })).toBe('status')
    expect(columnIdentityKey({ key: 'actions' })).toBe('actions')
  })

  it('两者皆空返回空串（不参与 resize）', () => {
    expect(columnIdentityKey({ title: 'x' })).toBe('')
  })
})

describe('applyColumnWidths', () => {
  it('override 应用到可拖列，其余列原样', () => {
    const out = applyColumnWidths(COLUMNS, { importMonth: 200, status: 300 })
    expect(out[0].width).toBe(200)
    expect(out[4].width).toBe(300)
  })

  it('fixed/操作/弹性列即使有 override 也不动', () => {
    const out = applyColumnWidths(COLUMNS, {
      customerName: 999,
      actions: 999,
      customerFeedback: 999,
    })
    expect(out[1].width).toBe(150)
    expect(out[3].width).toBe(56)
    expect(out[2].width).toBeUndefined()
  })

  it('不改原数组与原列对象（浅拷贝）', () => {
    const frozen = COLUMNS.map((c) => ({ ...c }))
    applyColumnWidths(COLUMNS, { importMonth: 200 })
    expect(COLUMNS).toEqual(frozen)
  })

  it('override 低于下限时 clamp 到 MIN_COLUMN_WIDTH', () => {
    const out = applyColumnWidths(COLUMNS, { importMonth: 10 })
    expect(out[0].width).toBe(MIN_COLUMN_WIDTH)
  })

  it('无 override / 空对象时返回原数组引用', () => {
    expect(applyColumnWidths(COLUMNS, undefined)).toBe(COLUMNS)
    expect(applyColumnWidths(COLUMNS, {})).toBe(COLUMNS)
  })

  it('hiddenColumns 过滤掉的列若残留 override 不影响可见列（per-column 合并）', () => {
    // 场景：status 列被隐藏后 override 残留，重显示时仍生效（per-column 无碍）
    const out = applyColumnWidths(COLUMNS, { status: 260 })
    expect(out[4].width).toBe(260)
  })
})

describe('clampColumnWidth', () => {
  it('下限 48，四舍五入', () => {
    expect(clampColumnWidth(30)).toBe(MIN_COLUMN_WIDTH)
    expect(clampColumnWidth(120.6)).toBe(121)
    expect(clampColumnWidth(500)).toBe(500)
  })

  it('非法值回退声明宽或下限', () => {
    expect(clampColumnWidth(Number.NaN, 150)).toBe(150)
    expect(clampColumnWidth(Number.NaN)).toBe(MIN_COLUMN_WIDTH)
  })
})

describe('sumColumnsWidth', () => {
  it('全列求和，无 width 列按默认 140', () => {
    // 90 + 150 + 140(弹性) + 56 + 90 = 526
    expect(sumColumnsWidth(COLUMNS)).toBe(526)
  })

  it('与 FeedbackTable 历史求和口径一致', () => {
    const cols = [{ width: 100 }, { width: 200 }, {}]
    expect(sumColumnsWidth(cols)).toBe(100 + 200 + 140)
  })

  it('空数组/非数组返回 0', () => {
    expect(sumColumnsWidth([])).toBe(0)
    expect(sumColumnsWidth(undefined)).toBe(0)
  })
})

describe('storage 读写（userId 隔离）', () => {
  it('key 格式：fb.table-width.<userId>.<tableKey>', () => {
    expect(buildTableWidthStorageKey('u1', 'postUseJira')).toBe('fb.table-width.u1.postUseJira')
  })

  it('保存后能读回，且用户间隔离', () => {
    const storage = makeMemoryStorage()
    saveColumnWidths('u1', 'postUseJira', { importMonth: 200 }, storage)
    saveColumnWidths('u2', 'postUseJira', { importMonth: 333 }, storage)
    expect(loadColumnWidths('u1', 'postUseJira', storage)).toEqual({ importMonth: 200 })
    expect(loadColumnWidths('u2', 'postUseJira', storage)).toEqual({ importMonth: 333 })
  })

  it('空 override 保存 = 清除 key', () => {
    const storage = makeMemoryStorage()
    saveColumnWidths('u1', 't', { importMonth: 200 }, storage)
    saveColumnWidths('u1', 't', {}, storage)
    expect(storage.__data['fb.table-width.u1.t']).toBeUndefined()
  })

  it('clearColumnWidths 移除 key', () => {
    const storage = makeMemoryStorage()
    saveColumnWidths('u1', 't', { importMonth: 200 }, storage)
    clearColumnWidths('u1', 't', storage)
    expect(loadColumnWidths('u1', 't', storage)).toEqual({})
  })

  it('损坏 JSON / 非对象结构返回空对象不抛错', () => {
    const storage = makeMemoryStorage()
    storage.setItem('fb.table-width.u1.t', '{broken json')
    expect(loadColumnWidths('u1', 't', storage)).toEqual({})
    storage.setItem('fb.table-width.u1.t', '[1,2,3]')
    expect(loadColumnWidths('u1', 't', storage)).toEqual({})
    storage.setItem('fb.table-width.u1.t', 'null')
    expect(loadColumnWidths('u1', 't', storage)).toEqual({})
  })

  it('读取时过滤非法条目（低于下限/非数值），保留合法条目', () => {
    const storage = makeMemoryStorage()
    storage.setItem(
      'fb.table-width.u1.t',
      JSON.stringify({ good: 200, tooSmall: 10, notNumber: 'x' })
    )
    expect(loadColumnWidths('u1', 't', storage)).toEqual({ good: 200 })
  })

  it('storage 抛异常时静默返回空对象 / 不抛错', () => {
    const badStorage = {
      getItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('quota')
      },
    }
    expect(loadColumnWidths('u1', 't', badStorage)).toEqual({})
    expect(() => saveColumnWidths('u1', 't', { a: 1 }, badStorage)).not.toThrow()
    expect(() => clearColumnWidths('u1', 't', badStorage)).not.toThrow()
  })
})

describe('scroll.x 硬编码守卫（红绿守卫：PostUseJiraTab 1040 / CustomerVisitTable 2140 回潮即红）', () => {
  it('PostUseJiraTab 不再出现硬编码 scroll x 1040', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../pages/PostUseJiraTab.jsx', import.meta.url), 'utf-8')
    )
    expect(src).not.toContain('scroll={{ x: 1040 }}')
    // 必须改为动态求和
    expect(src).toContain('sumColumnsWidth')
  })

  it('Feedbacks.jsx 回访表不再出现硬编码 scroll x 2140', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../pages/Feedbacks.jsx', import.meta.url), 'utf-8')
    )
    expect(src).not.toContain('scroll={{ x: 2140 }}')
  })
})
