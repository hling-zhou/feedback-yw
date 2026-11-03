// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

/*
 * GeneralizationCard 数据驱动渲染（jsdom + createRoot + act）。
 * useEffect 异步数据回来后重渲染；静态首帧用 renderToStaticMarkup 另测。
 */

vi.mock('../../lib/generalizationClient.js', () => ({
  listGeneralizationLinksByRecord: vi.fn(async () => []),
  getGeneralizationHint: vi.fn(async () => null),
  adoptGeneralizationHint: vi.fn(async () => ({ hint: {}, issue: {} })),
  dismissGeneralizationHint: vi.fn(async () => ({ hint: {} })),
  detachGeneralizationLink: vi.fn(async () => ({ ok: true })),
  getGeneralizationIssue: vi.fn(async () => ({ issue: {}, links: [], actionRefs: [] })),
}))

const {
  listGeneralizationLinksByRecord,
  getGeneralizationHint,
  getGeneralizationIssue,
} = /** @type {any} */ (await import('../../lib/generalizationClient.js'))

const { default: GeneralizationCard } = await import('./GeneralizationCard.jsx')

/**
 * @param {Record<string, unknown>} props
 * @returns {Promise<string>}
 */
async function renderAsync(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(/** @type {any} */ (GeneralizationCard), props))
  })
  // flush 微任务（useEffect 内 Promise.all 完成 + setState）
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10))
  })
  const html = container.innerHTML
  root.unmount()
  container.remove()
  return html
}

/** @param {Record<string, unknown>} [overrides] */
const makeRecord = (overrides = {}) => ({
  id: 'rec-1',
  productKey: 'eip',
  product: '弹性公网IP',
  ticketId: 'T100',
  dataSourceType: 'complaint_ticket',
  ...overrides,
})

describe('GeneralizationCard 数据驱动渲染（jsdom + act）', () => {
  it('pending hint：AI 建议条渲染（范畴/把握/理由 + 创建/忽略按钮）', async () => {
    getGeneralizationHint.mockResolvedValue({
      status: 'pending',
      suggested: 'yes',
      category: 'api_doc',
      scope: 'multi_scenario',
      confidence: 'medium',
      reason: 'API 文档 region 可选值说明遗漏',
    })
    listGeneralizationLinksByRecord.mockResolvedValue([])
    const html = await renderAsync({ feedback: makeRecord(), canEdit: true })
    expect(html).toContain('AI 建议：需要举一反三')
    expect(html).toContain('API 文档错误')
    expect(html).toContain('把握：中')
    expect(html).toContain('region 可选值说明遗漏')
    expect(html).toContain('创建举一反三问题')
    // antd 两字按钮自动插空格（忽 略）——两种形态都断言
    expect(/忽\s*略/.test(html)).toBe(true)
  })

  it('confirmed link：只读两字段（根因/优化 + 待补全兜底 + 状态 Tag + 解除入口）', async () => {
    getGeneralizationHint.mockResolvedValue(null)
    listGeneralizationLinksByRecord.mockResolvedValue([
      {
        id: 'l1', issueId: 'gi-1', recordId: 'rec-1',
        recordDataSource: 'complaint_ticket', ticketId: 'T100',
        linkStatus: 'confirmed', linkSource: 'manual',
        matchConfidence: '', matchReason: '', matchedExcerpt: '',
        proposedAt: '', reviewedBy: '', reviewedAt: '', createdAt: '',
      },
    ])
    getGeneralizationIssue.mockResolvedValue({
      issue: {
        id: 'gi-1', title: '退订入口难找', status: 'in_progress',
        rootCause: '导航层级过深', optimization: '', category: 'console_ux',
      },
      links: [], actionRefs: [],
    })
    const html = await renderAsync({ feedback: makeRecord(), canEdit: true })
    expect(html).toContain('退订入口难找')
    expect(html).toContain('进行中')
    expect(html).toContain('根因分析')
    expect(html).toContain('导航层级过深')
    expect(html).toContain('待补全')
    // 只读：无编辑控件
    expect(html).not.toContain('<textarea')
    expect(html).toContain('解除')
  })

  it('dismissed hint：不渲染建议条（忽略记忆）', async () => {
    getGeneralizationHint.mockResolvedValue({ status: 'dismissed' })
    listGeneralizationLinksByRecord.mockResolvedValue([])
    const html = await renderAsync({ feedback: makeRecord(), canEdit: true })
    expect(html).not.toContain('AI 建议：需要举一反三')
  })

  it('canEdit=false：无纳入按钮无建议操作按钮（jsdom 数据态验证）', async () => {
    getGeneralizationHint.mockResolvedValue({
      status: 'pending', category: 'api_doc', confidence: 'medium', reason: 'r',
    })
    listGeneralizationLinksByRecord.mockResolvedValue([])
    const html = await renderAsync({ feedback: makeRecord(), canEdit: false })
    expect(html).not.toContain('纳入举一反三')
    expect(html).not.toContain('创建举一反三问题')
  })

  it('空态首帧（renderToStaticMarkup）：标题 + 蓝底 + 常驻入口不整卡消失', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(
      React.createElement(/** @type {any} */ (GeneralizationCard), {
        feedback: makeRecord(),
        canEdit: true,
      }),
    )
    expect(html).toContain('举一反三')
    expect(html).toContain('纳入举一反三')
    expect(html).toContain('在多个场景或多个产品反复出现')
    expect(html).toContain('#f0f7ff')
  })
})
