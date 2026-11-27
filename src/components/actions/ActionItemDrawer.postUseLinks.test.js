import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 11-27 需求守卫：举措详情抽屉必须消费用后即评关联链
 * （/api/post-use-actions/linked/:actionId）——列表「关联反馈」单元格
 * （PostUseLinkedFeedbackCell）有数量而抽屉恒空的断裂回潮即红。
 */
describe('ActionItemDrawer post-use linked sources wiring', () => {
  const source = fs.readFileSync(new URL('./ActionItemDrawer.jsx', import.meta.url), 'utf8')

  it('fetches post-use linked sources and passes them to the list component', () => {
    // 取数上提：抽屉单次 fetch 同源接口
    expect(source).toContain('listPostUseActionSources(item.id)')
    // 纯展示组件接收 traces/visits props（数据由宿主传入，不自取数）
    expect(source).toMatch(/<PostUseLinkedSourceList\s+traces=\{postUseSources\.traces\}\s+visits=\{postUseSources\.visits\}/)
  })

  it('title count is same-source with the list cell (traces + visits alongside ticket count)', () => {
    // 数量同源：用后即评举措标题并列展示溯源/回访数与工单数，不再单报工单数
    expect(source).toContain('溯源/回访 ${postUseLinkedCount}')
    expect(source).toContain('linkedTicketCount')
  })

  it('renders the section only for post_use source actions', () => {
    expect(source).toContain("item.source === 'post_use' ? (")
  })
})
