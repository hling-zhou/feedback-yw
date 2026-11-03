import { describe, expect, it } from 'vitest'
import { buildGeneralizationIssuesCsv } from './generalizationExportCsv.js'

const mkIssue = (overrides = {}) => ({
  id: 'i1',
  productName: '弹性公网IP',
  title: '批量删除部分失败',
  summary: '批量删除安全组只成功一半',
  category: 'code_logic',
  scope: 'multi_scenario',
  rootCause: '批量接口事务未包裹，部分失败未回滚',
  optimization: '接口侧包裹事务并回滚部分失败',
  status: 'in_progress',
  occurrenceCount: 3,
  ticketCount: 3,
  firstSeenAt: '2026-10-01T00:00:00.000Z',
  lastSeenAt: '2026-10-28T00:00:00.000Z',
  originActionId: '',
  payload: { keywords: ['批量删除', '事务'], notes: '' },
  ...overrides,
})

describe('buildGeneralizationIssuesCsv', () => {
  it('emits BOM + headers + rows with CRLF（含范畴/共性/根因/优化四新列）', () => {
    const { csv, rowCount } = buildGeneralizationIssuesCsv({ issues: [mkIssue()] })
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv).toContain(
      '产品,问题标题,问题描述,范畴,共性范围,根因分析,优化方案,状态,出现次数,工单证据数,首次出现,最近出现,关键词,备注,来源举措ID,证据明细',
    )
    expect(rowCount).toBe(1)
    expect(csv.includes('\r\n')).toBe(true)
  })

  it('根因分析/优化方案全文导出不截断（v3.4 口径）', () => {
    const longRoot = '经排查根因为批量删除接口的事务包裹逻辑缺失，导致部分成功部分失败时' + 'x'.repeat(3000)
    const longOpt = '优化方案：在服务端为批量操作统一包裹事务，失败时整体回滚，' + 'y'.repeat(3000)
    const { csv } = buildGeneralizationIssuesCsv({
      issues: [mkIssue({ rootCause: longRoot, optimization: longOpt })],
    })
    expect(csv).toContain(longRoot)
    expect(csv).toContain(longOpt)
  })

  it('escapes fields containing commas/quotes/newlines (RFC 4180)', () => {
    const { csv } = buildGeneralizationIssuesCsv({
      issues: [mkIssue({ summary: '包含,逗号和"引号"还有\n换行' })],
    })
    expect(csv).toContain('"包含,逗号和""引号""还有')
    expect(csv).toContain('换行"')
  })

  it('evidence detail column joins confirmed links', () => {
    const { csv } = buildGeneralizationIssuesCsv({
      issues: [mkIssue()],
      linksByIssue: [
        {
          issueId: 'i1',
          links: [
            { linkStatus: 'confirmed', ticketId: 'T101', recordId: 'r1', matchedExcerpt: '批量删除只成功一半' },
            { linkStatus: 'pending_suggest', ticketId: 'T102', recordId: 'r2', matchedExcerpt: '不应出现' },
          ],
        },
      ],
    })
    expect(csv).toContain('T101：批量删除只成功一半')
    expect(csv).not.toContain('不应出现')
  })

  it('status 三态本地化文案', () => {
    const cases = /** @type {const} */ ([
      ['in_progress', '进行中'],
      ['completed', '已完成'],
      ['terminated', '未完成终止'],
    ])
    for (const [status, label] of cases) {
      const { csv } = buildGeneralizationIssuesCsv({ issues: [mkIssue({ status: /** @type {any} */ (status) })] })
      expect(csv).toContain(label)
    }
  })

  it('来源举措列：origin_action_id 与中间表 actionRefs 去重并列', () => {
    const { csv } = buildGeneralizationIssuesCsv({
      issues: [mkIssue({ originActionId: 'act-1' })],
      linksByIssue: [
        {
          issueId: 'i1',
          links: [],
          actionRefs: [
            { actionItemId: 'act-1', kind: 'created' },
            { actionItemId: 'act-2', kind: 'linked' },
          ],
        },
      ],
    })
    expect(csv).toContain('act-1、act-2')
  })

  it('caps rows at 5000 and flags truncated', () => {
    const issues = Array.from({ length: 5010 }, (_, i) => mkIssue({ id: `i${i}`, title: `t${i}` }))
    const { rowCount, truncated } = buildGeneralizationIssuesCsv({ issues })
    expect(rowCount).toBe(5000)
    expect(truncated).toBe(true)
  })

  it('empty issues yields header-only csv', () => {
    const { csv, rowCount } = buildGeneralizationIssuesCsv({ issues: [] })
    expect(rowCount).toBe(0)
    expect(csv.split('\r\n')).toHaveLength(1)
  })

  it('根因/优化为空时导出空列（创建可空口径）', () => {
    const { csv } = buildGeneralizationIssuesCsv({
      issues: [mkIssue({ rootCause: '', optimization: '' })],
    })
    // 空字段 csvEscape 返回空串——行内连续逗号存在即证明空列在位
    const row = csv.split('\r\n')[1]
    expect(row).toBeTruthy()
    expect(String(row).split(',').length).toBe(16)
  })
})
