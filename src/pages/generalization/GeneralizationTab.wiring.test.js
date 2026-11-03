import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p) =>
  fs.readFileSync(new URL(p, import.meta.url), 'utf8')

describe('Actions generalization tab wiring', () => {
  const source = read('../Actions.jsx')

  it('renders generalization tab via drawer host container (not bare tab)', () => {
    // 2026-11-04 接线：举一反三 Tab 经 GeneralizationTabWithDrawer 容器渲染，
    // 由容器注入 onOpenRecord 并挂 FeedbackDrawer（详情抽屉/队列里的工单号可点、叠加打开）
    expect(source).toContain('<GeneralizationTabWithDrawer />')
    expect(source).not.toContain("children: <GeneralizationTab />")
    expect(source).not.toContain("import GeneralizationTab from './generalization/GeneralizationTab.jsx'")
  })

  it('host wrapper delegates to shared TicketDrawerHost with tab signature adapter', () => {
    // 2026-11-04 单源化：容器共享实现（三级查找 + FeedbackDrawer 挂载）收敛到
    // TicketDrawerHost 唯一真源，WithDrawer 只剩签名适配薄包装
    const host = read('../GeneralizationTabWithDrawer.jsx')
    expect(host).toContain("import GeneralizationTab from './generalization/GeneralizationTab.jsx'")
    expect(host).toContain("import TicketDrawerHost from '../components/tickets/TicketDrawerHost.jsx'")
    expect(host).toContain(
      '<GeneralizationTab onOpenRecord={(link) => void openRecord(link)} />',
    )
    // 薄包装不得自带抽屉实现（回潮到自持 FeedbackDrawer/查找逻辑 = 双源）
    expect(host).not.toContain('useFeedbackDrawerSelection')
    expect(host).not.toContain('fetchFeedbackRecordsByTicketIds')
  })

  it('shared TicketDrawerHost implements 3-level lookup and stacks (never closes host)', () => {
    const shared = read('../../components/tickets/TicketDrawerHost.jsx')
    expect(shared).toContain('<FeedbackDrawer')
    expect(shared).toContain('useFeedbackDrawerSelection')
    expect(shared).toContain('setSelectedDirect')
    // 三级查找顺序齐备：ticketId 缓存 → recordId 匹配 → 服务端补拉
    expect(shared).toContain('feedbackByTicketId.get(ticketId)')
    expect(shared).toContain('feedbackById.has(recordId)')
    expect(shared).toContain('fetchFeedbackRecordsByTicketIds')
    // 叠加语义守卫：openRecord 不得触碰任何宿主 open 状态
    expect(shared).not.toContain('setDetailOpen(false)')
  })

  it('generalization tab consumes onOpenRecord in detail drawer and queue', () => {
    const tab = read('../generalization/GeneralizationTab.jsx')
    expect(tab).toContain('export default function GeneralizationTab({ onOpenRecord })')
    expect(tab).toContain('onClick={() => onOpenRecord(link)}')
    expect(tab).toContain('onOpenRecord({ recordId, recordDataSource: dataSourceType })')
  })
})
