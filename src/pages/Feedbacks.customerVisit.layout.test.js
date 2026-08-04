import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Feedbacks customer visit tab', () => {
  const source = fs.readFileSync(new URL('./Feedbacks.jsx', import.meta.url), 'utf8')

  it('includes a read-only customer visit tab with search and export', () => {
    expect(source).toContain('FEEDBACK_LANE_CUSTOMER_VISITS')
    expect(source).toContain('客服部回访')
    expect(source).toContain('搜索客户名称')
    expect(source).toContain('buildPostUseCustomerVisitRows')
    expect(source).toContain('<CustomerVisitTable rows={customerVisitTableRows} />')
  })
})
