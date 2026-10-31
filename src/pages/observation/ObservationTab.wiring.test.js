import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p) =>
  fs.readFileSync(new URL(p, import.meta.url), 'utf8')

describe('Actions observation tab wiring', () => {
  const source = read('../Actions.jsx')

  it('registers observation tab between problem-reduction and playbook', () => {
    expect(source).toContain("rawTab === 'observation'")
    expect(source).toContain("key: 'observation'")
    expect(source).toContain("label: '留观问题'")
    expect(source.indexOf("key: 'problem-reduction'")).toBeLessThan(
      source.indexOf("key: 'observation'"),
    )
    expect(source.indexOf("key: 'observation'")).toBeLessThan(
      source.indexOf("key: 'playbook'"),
    )
  })

  it('embeds both list and match queue in the tab', () => {
    expect(source).toContain('<ObservationTab />')
    expect(source).toContain('<ObservationMatchQueue />')
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
