import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * P2-0 layout regression: A → B1 → B2 → C → D (DESIGN-20260601-1 §3.1).
 * Source-order check — no DOM render harness required.
 */
describe('FeedbackDrawer layout (P2-0)', () => {
  const src = readFileSync(
    resolve(import.meta.dirname, 'FeedbackDrawer.jsx'),
    'utf8',
  )

  function marker(label) {
    const index = src.indexOf(label)
    expect(index, `missing marker: ${label}`).toBeGreaterThan(-1)
    return index
  }

  it('orders sections A → B1 → B2 → C → D', () => {
    const a = marker('ticketMetaLine')
    const b1 = marker('title="工单分类"')
    const b2 = marker('title="投诉原因（终判）"')
    const cRequest = marker('shrink-0">客户请求内容</span>')
    const cPain = marker('shrink-0">需求痛点挖掘</span>')
    const cOpt = marker('title="优化建议"')
    const cAuto = marker('优化建议 · 自动生成')
    const cManual = marker('优化建议 · 人工复核')
    const cProductGroup = marker('label="产品组优化建议"')
    const cEstablishedSection = marker('优化建议 · 确立举措')
    const cLibrarySelect = marker('从举措库选择')
    const cActionContent = marker('label="举措内容"')
    const cSchedule = marker('label="排期"')
    const dSection = marker('{/* D · 处理与备注 */}')
    const dHandling = marker('处理意见（工单原文）')
    const dRootCause = marker('title="根因排查"')
    const dNote = marker('Typography.Text strong className="text-xs">备注')

    expect(a).toBeLessThan(b1)
    expect(b1).toBeLessThan(b2)
    expect(b2).toBeLessThan(cRequest)
    expect(cRequest).toBeLessThan(cPain)
    expect(cPain).toBeLessThan(cOpt)
    expect(cOpt).toBeLessThan(cAuto)
    expect(cAuto).toBeLessThan(cManual)
    expect(cManual).toBeLessThan(cProductGroup)
    expect(cProductGroup).toBeLessThan(cEstablishedSection)
    expect(cEstablishedSection).toBeLessThan(cLibrarySelect)
    expect(cLibrarySelect).toBeLessThan(cActionContent)
    expect(cActionContent).toBeLessThan(cSchedule)
    expect(cSchedule).toBeLessThan(dSection)
    expect(dSection).toBeLessThan(dHandling)
    expect(dHandling).toBeLessThan(dRootCause)
    expect(dRootCause).toBeLessThan(dNote)
  })

  it('places handling opinion after analysis cards (not between B and C)', () => {
    const b2 = marker('title="投诉原因（终判）"')
    const cRequest = marker('shrink-0">客户请求内容</span>')
    const dHandling = marker('处理意见（工单原文）')

    expect(cRequest).toBeLessThan(dHandling)
    expect(b2).toBeLessThan(dHandling)
  })
})
