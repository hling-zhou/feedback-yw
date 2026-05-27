import { describe, expect, it } from 'vitest'
import {
  buildTicketDetailDisplay,
  extractCustomerRequestSegments,
  extractSolutionAndResultParts,
  parseLabelValueBlocks,
  resolveDisplayCustomerQuote,
  sortCustomerRequestSegments,
} from './ticketDetailDisplay.js'

describe('parseLabelValueBlocks', () => {
  it('splits inline labeled lines', () => {
    const blocks = parseLabelValueBlocks('客户问题：无法访问\n处理意见：已放行端口')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].label).toBe('客户问题')
    expect(blocks[1].label).toBe('处理意见')
  })
})

describe('ticketDetailDisplay', () => {
  it('extracts customer requests without platform solution lines', () => {
    const segments = extractCustomerRequestSegments({
      handlingText: '已协助客户调整安全组并恢复访问',
      rawText:
        '客户问题：公网 IP 无法访问\n处理意见：已放行 443 端口并复测通过\n\n【追加信息】\n客户补充：HTTPS 仍提示证书错误',
    })
    expect(segments.some((s) => /无法访问/.test(s.text))).toBe(true)
    expect(segments.some((s) => /追加诉求/.test(s.label || ''))).toBe(true)
    expect(segments.some((s) => /已协助|放行.*端口/.test(s.text))).toBe(false)
  })

  it('uses customerQuote as SSOT for customer requests when present', () => {
    const display = buildTicketDetailDisplay({
      handlingText: '已放行 443 端口并复测通过',
      rawText: '【受理内容】\n公网 IP 无法访问\n\n【处理意见】\n已放行 443 端口',
      customerQuote: '公网 IP 无法访问',
    })
    expect(display.customerRequestText).toMatch(/客户原话[：:]\s*公网 IP 无法访问/)
    expect(display.customerRequestText).not.toMatch(/已放行|443/)
  })

  it('uses customerQuote even when it lacks demand-keyword heuristics', () => {
    const display = buildTicketDetailDisplay({
      handlingText: '已处理',
      rawText: '【受理内容】\n10.0.0.1\n【追加信息】\n无/不涉及',
      customerQuote: '10.0.0.1',
    })
    expect(display.customerRequestText).toMatch(/客户原话[：:]\s*10\.0\.0\.1/)
    expect(display.customerRequestText).not.toMatch(/追加诉求|无\/不涉及/)
  })

  it('drops meaningless append-only placeholders from customer requests', () => {
    const display = buildTicketDetailDisplay({
      handlingText: '已协助处理',
      rawText: '【受理内容】\n\n【处理意见】\n已处理\n\n【追加信息】\n无/不涉及',
      customerQuote: '',
    })
    expect(display.customerRequestText).not.toMatch(/追加诉求|无\/不涉及/)
  })

  it('extracts customer problem from composite customerQuote with embedded 处理意见', () => {
    const composite =
      '【客户问题】:几个郑州资源池的公网ip需要转移。2、【问题原因】:同上3、【解决方案】:已建群反馈&客服组&处理意见：请扫码进群【追加信息】无/不涉及'
    const essence = resolveDisplayCustomerQuote(composite)
    expect(essence).toMatch(/郑州资源池/)
    expect(essence).not.toMatch(/已建群|处理意见/)
    const display = buildTicketDetailDisplay({
      handlingText: '已建群处理',
      rawText: '【受理内容】\n详细内容：几个郑州资源池的公网ip需要转移',
      customerQuote: composite,
    })
    expect(display.customerRequestText).toMatch(/郑州资源池/)
    expect(display.customerRequestText).not.toMatch(/已建群/)
  })

  it('does not add meaningless append when customerQuote is SSOT', () => {
    const display = buildTicketDetailDisplay({
      handlingText: '已处理',
      rawText: '【受理内容】\n公网不通\n【追加信息】\n无/不涉及',
      customerQuote: '公网不通',
    })
    expect(display.customerRequestText).toMatch(/公网不通/)
    expect(display.customerRequestText).not.toMatch(/无\/不涉及/)
  })

  it('keeps solution in solution block only, not in customer requests', () => {
    const display = buildTicketDetailDisplay({
      handlingText: '已协助客户调整安全组',
      responseText: '建议刷新 DNS 后重试',
      rawText: '详细内容：想要开通 EIP\n处理意见：已为客户开通',
      customerQuote: '想要开通 EIP',
    })
    expect(display.customerRequestText).toMatch(/开通 EIP/)
    expect(display.customerRequestText).not.toMatch(/已协助|已为客户开通/)
    expect(display.solutionAndResultText).toMatch(/安全组|DNS|已为客户开通/)
  })

  it('does not fabricate customer outcome when absent', () => {
    const parts = extractSolutionAndResultParts({
      handlingText: '已协助客户调整安全组并恢复访问',
      responseText: '建议客户刷新 DNS 缓存后重试',
      rawText: '客户问题：无法访问',
    })
    expect(parts.solutions.length).toBeGreaterThan(0)
    expect(parts.customerOutcome).toHaveLength(0)
    expect(buildTicketDetailDisplay({
      handlingText: '已处理',
      rawText: '客户问题：无法访问',
    }).solutionAndResultText).not.toContain('【客户侧处理结果】')
  })

  it('extracts explicit customer outcome when present', () => {
    const parts = extractSolutionAndResultParts({
      handlingText: '已调整配置',
      rawText:
        '客户问题：无法访问\n处理结果：客户确认业务已恢复正常',
    })
    expect(parts.customerOutcome.some((s) => /客户确认|恢复正常/.test(s.text))).toBe(true)
    expect(
      buildTicketDetailDisplay({
        handlingText: '已调整配置',
        rawText:
          '客户问题：无法访问\n处理结果：客户确认业务已恢复正常',
      }).solutionAndResultText,
    ).toContain('【客户侧处理结果】')
  })

  it('orders customer requests with initial first then append chronologically', () => {
    const segments = extractCustomerRequestSegments({
      handlingText: '已处理',
      rawText:
        '客户问题：首次无法访问\n处理意见：已处理\n\n【追加信息】\n2026-04-02 客户补充证书错误\n\n2026-04-01 客户补充端口不通',
    })
    expect(segments[0].phase).toBe('initial')
    expect(segments[0].text).toMatch(/无法访问/)
    expect(segments[segments.length - 1].phase).toBe('append')
    const appendTexts = segments.filter((s) => s.phase === 'append').map((s) => s.text)
    if (appendTexts.length >= 2) {
      expect(appendTexts[0]).toMatch(/04-01|端口不通/)
      expect(appendTexts[1]).toMatch(/04-02|证书/)
    }
  })

  it('sortCustomerRequestSegments keeps initial block before append', () => {
    const sorted = sortCustomerRequestSegments([
      { label: '追加诉求', text: 'later', phase: 'append', seq: 1 },
      { label: '客户问题', text: 'first', phase: 'initial', seq: 0 },
    ])
    expect(sorted[0].phase).toBe('initial')
    expect(sorted[1].phase).toBe('append')
  })

  it('does not treat platform 处理结果 as customer outcome', () => {
    const parts = extractSolutionAndResultParts({
      rawText: '客户问题：无法访问\n处理结果：已协助客户完成配置并复测通过',
    })
    expect(parts.customerOutcome).toHaveLength(0)
  })
})
