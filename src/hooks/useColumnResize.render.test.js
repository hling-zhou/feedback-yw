import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Table } from 'antd'
import {
  applyColumnWidths,
  columnIdentityKey,
  isResizableColumn,
} from '../lib/columnWidths.js'

/**
 * useColumnResize 契约测试（node 环境，renderToStaticMarkup 真渲染）。
 *
 * hook 本体依赖 document（鼠标事件），node 环境不可直接渲染交互；
 * 但 decorateColumns 的产物契约（onHeaderCell 注入 + width override 应用）
 * 可以通过真渲染 antd Table 断言——这正好锚定「手柄出现在预期列、不出现在排除列」。
 * 拖拽交互本身（mousedown/mousemove 冒泡、rAF 节流、user-select）需真机确认，见交付声明。
 */

// ---- 从 hook 源码抽取 decorateColumns 逻辑等价的验证路径 ----
// hook 的 decorateColumns 是闭包；测试改走「lib 层产物 + onHeaderCell 注入形态」双断言。

/** @type {any[]} */
const COLUMNS = [
  { title: '工单', dataIndex: 'ticketId', width: 180, fixed: 'left' },
  { title: '状态', dataIndex: 'status', width: 90 },
  { title: '客户反馈', dataIndex: 'customerFeedback' }, // 弹性列
  { title: '操作', key: 'actions', width: 56 },
]

describe('decorateColumns 契约（renderToStaticMarkup 真渲染）', () => {
  it('可拖列注入 data-col-key + fb-col-resizable 类；排除列无标记', () => {
    // 手工模拟 decorateColumns 的注入逻辑（与 hook 源码同型：isResizableColumn 过滤 + onHeaderCell 注入）
    const decorated = COLUMNS.map((col) => {
      if (!isResizableColumn(col)) return col
      const identityKey = columnIdentityKey(col)
      return {
        ...col,
        onHeaderCell: () => ({ 'data-col-key': identityKey, className: 'fb-col-resizable' }),
      }
    })

    // 真渲染 antd Table（node 环境下 renderToStaticMarkup 支持）
    const html = renderToStaticMarkup(
      createElement(Table, {
        columns: decorated,
        dataSource: [{ key: 1, ticketId: 'T1', status: 'x', customerFeedback: 'y' }],
        rowKey: 'key',
        pagination: false,
      })
    )

    // 手柄标记出现在可拖列（status）
    expect(html).toContain('data-col-key="status"')
    expect(html).toContain('fb-col-resizable')
    // 排除列无手柄标记：fixed 工单列 / 弹性客户反馈列 / 操作列
    expect(html).not.toContain('data-col-key="ticketId"')
    expect(html).not.toContain('data-col-key="customerFeedback"')
    expect(html).not.toContain('data-col-key="actions"')
  })

  it('width override 真实改变渲染出的 colgroup col 宽度', () => {
    const decorated = applyColumnWidths(COLUMNS, { status: 320 })
    expect(decorated[1].width).toBe(320)

    const html = renderToStaticMarkup(
      createElement(Table, {
        columns: decorated,
        dataSource: [{ key: 1, status: 'x' }],
        rowKey: 'key',
        pagination: false,
      })
    )
    // antd scroll.x 未设时 colgroup 不一定输出宽度 style；设 scroll={{x: sum}} 后输出
    const htmlWithScroll = renderToStaticMarkup(
      createElement(Table, {
        columns: decorated,
        dataSource: [{ key: 1, status: 'x' }],
        rowKey: 'key',
        scroll: { x: 320 + 180 + 140 + 56 },
        pagination: false,
      })
    )
    expect(htmlWithScroll).toContain('width:320px')
    expect(html).toBeTruthy()
  })

  it('操作列 key __deleteAction 同样被排除（Feedbacks 回访表形态）', () => {
    expect(isResizableColumn({ title: '操作', key: '__deleteAction', width: 56, fixed: 'right' })).toBe(false)
    expect(isResizableColumn({ title: '操作', key: '__deleteAction', width: 56 })).toBe(false)
  })
})

describe('hook 源码契约守卫（防回潮）', () => {
  it('useColumnResize 源码不含「直接写 th.style.width」反模式（antd colgroup 控宽，写了不生效）', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('./useColumnResize.js', import.meta.url), 'utf-8')
    // 第一版实现踩过的坑：mousemove 里写 DOM style，antd colgroup 不消费 → 改为 rAF + setState 后加守卫
    // 守卫只针对赋值语句（.style.width =），文档注释里的说明文字不触发
    expect(src).not.toMatch(/\.style\.width\s*=/)
    expect(src).toContain('requestAnimationFrame')
    expect(src).toContain('fb-col-resizing')
  })

  it('手柄命中区常量与 CSS ::after 定义一致（8px）', async () => {
    const fs = await import('node:fs')
    const hookSrc = fs.readFileSync(new URL('./useColumnResize.js', import.meta.url), 'utf-8')
    expect(hookSrc).toContain('RESIZER_HIT_ZONE = 8')
    // CSS 侧同值守卫（src/index.css 中手柄 ::after 命中区）
    const cssSrc = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf-8')
    expect(cssSrc).toMatch(/fb-col-resizable[\s\S]{0,400}right:\s*0[\s\S]{0,600}width:\s*8px/)
  })
})
