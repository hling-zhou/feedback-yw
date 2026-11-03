import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p) =>
  fs.readFileSync(new URL(p, import.meta.url), 'utf8')

describe('Actions observation tab wiring', () => {
  const source = read('../Actions.jsx')

  it('registers observation tab between problem-reduction and generalization', () => {
    // 2026-11-04 tab 清单单源化：ACTIONS_TAB_ITEMS 唯一真源 + 派生白名单
    // （旧手写 rawTab === 'observation' 白名单链已删除，断言改为对齐单源实现）
    expect(source).toContain("key: 'observation'")
    expect(source).toContain("label: '留观问题'")
    expect(source.indexOf("key: 'problem-reduction'")).toBeLessThan(
      source.indexOf("key: 'observation'"),
    )
    expect(source.indexOf("key: 'observation'")).toBeLessThan(
      source.indexOf("key: 'generalization'"),
    )
  })

  it('embeds both list and match queue in the tab (via drawer host container)', () => {
    // 2026-11-02 接线收尾：留观 Tab 经 ObservationTabWithDrawer 容器渲染，
    // 由容器注入 onOpenRecord 并挂 FeedbackDrawer（工单号/评价原地可点）
    // 2026-11-04 单源化：容器共享实现收敛到 TicketDrawerHost（三级查找/FeedbackDrawer
    // 挂载唯一真源），WithDrawer 只剩签名适配
    expect(source).toContain('<ObservationTabWithDrawer />')
    const host = read('../ObservationTabWithDrawer.jsx')
    expect(host).toContain("import TicketDrawerHost from '../components/tickets/TicketDrawerHost.jsx'")
    expect(host).toContain('<TicketDrawerHost')
    expect(host).toContain('<ObservationTab onOpenRecord={(link) => void openRecord(link)} />')
    expect(host).toContain('<ObservationMatchQueue')
    expect(host).toContain('openRecordByPair(recordId, dataSourceType)')
    const shared = read('../../components/tickets/TicketDrawerHost.jsx')
    expect(shared).toContain('<FeedbackDrawer')
    expect(shared).toContain('useFeedbackDrawerSelection')
    expect(shared).toContain('setSelectedDirect')
  })

  it('renders stats card reusing the shared product-status chart (2026-11-04 统计可视化)', () => {
    const tab = read('ObservationTab.jsx')
    expect(tab).toContain("from '../../components/charts/ActionItemProductStatusChart.jsx'")
    expect(tab).toContain('getObservationIssueStats')
    expect(tab).toContain('OBSERVATION_ISSUE_CHART_COLORS')
    expect(tab).toContain('rateLabel="升级率"')
    expect(tab).toContain('countNoun="个留观问题"')
    const domain = read('../../domain/observationIssue.js')
    expect(domain).toContain('export const OBSERVATION_ISSUE_CHART_COLORS')
    const client = read('../../lib/observationClient.js')
    expect(client).toContain('export async function getObservationIssueStats')
  })
})

describe('FeedbackDrawer observation card wiring', () => {
  const source = read('../../components/FeedbackDrawer.jsx')

  it('renders ObservationCard before the meeting todo card in analysis section', () => {
    expect(source).toContain("import ObservationCard from './observation/ObservationCard.jsx'")
    const cardIdx = source.indexOf('<ObservationCard')
    expect(cardIdx).toBeGreaterThan(0)
    const todoIdx = source.indexOf('会议待办')
    expect(todoIdx).toBeGreaterThan(cardIdx)
  })

  it('passes record feedback and permission through', () => {
    expect(source).toContain('feedback={feedback}')
    expect(source).toContain('canEdit={canEdit}')
    expect(source).toContain("recordDataSource={isPostUseLibrary ? 'post_use_rating'")
  })
})

describe('ObservationTab structure', () => {
  const source = read('ObservationTab.jsx')

  it('list columns include counts split by source and status', () => {
    expect(source).toContain("dataIndex: 'occurrenceCount'")
    expect(source).toContain("dataIndex: 'ticketCount'")
    expect(source).toContain("dataIndex: 'ratingCount'")
    expect(source).toContain("dataIndex: 'status'")
  })

  it('two entries: expandable row + detail drawer', () => {
    expect(source).toContain('expandable=')
    expect(source).toContain('<AntDrawer')
  })

  it('evidence grouped by source in expanded row', () => {
    expect(source).toContain('工单证据')
    expect(source).toContain('评价证据')
    expect(source).toContain('待复核建议')
  })
})

describe('ObservationMatchQueue structure', () => {
  const source = read('ObservationMatchQueue.jsx')

  it('queue columns and three-way review actions', () => {
    expect(source).toContain("dataIndex: 'issueTitle'")
    expect(source).toContain("dataIndex: 'matchConfidence'")
    expect(source).toContain("dataIndex: 'matchReason'")
    expect(source).toContain('确认关联')
    expect(source).toContain('新建留观')
    expect(source).toContain('不纳入')
  })

  it('exposes pending count breakdown header', () => {
    expect(source).toContain('待处理')
  })
})
