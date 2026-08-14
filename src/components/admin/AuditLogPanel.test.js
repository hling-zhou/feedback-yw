import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION_LABELS, formatAuditDetailSummary } from './AuditLogPanel.jsx'

describe('AuditLogPanel helpers', () => {
  it('formatAuditDetailSummary includes common fields', () => {
    expect(
      formatAuditDetailSummary({
        count: 10,
        dataSourceType: 'complaint_ticket',
        importMonth: '2026-05',
      }),
    ).toContain('条数 10')
    expect(formatAuditDetailSummary({ actionId: 'a1', fields: ['content', 'status'] })).toContain(
      '举措 a1',
    )
  })

  it('AUDIT_ACTION_LABELS covers action and storage events', () => {
    expect(AUDIT_ACTION_LABELS['action.update']).toBe('更新举措')
    expect(AUDIT_ACTION_LABELS['storage.record_update']).toBe('更新工单')
    expect(AUDIT_ACTION_LABELS['storage.taxonomy_update']).toBe('保存打标配置')
    expect(AUDIT_ACTION_LABELS['auth.login']).toBe('登录')
  })
})
