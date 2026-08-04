import { describe, expect, it } from 'vitest'
import { processRow, reprocessFeedbackRecord } from './pipeline.js'

describe('pipeline plaintext import fields', () => {
  it('processRow preserves plaintext IPs in imported fields and sourceColumns', () => {
    const row = {
      dataSourceType: 'complaint_ticket',
      rawText: '客户反馈服务器 192.168.1.10 无法访问，白名单需要放通 10.0.0.5:8085。',
      handlingText: '已协助客户核对 192.168.1.10 路由并放通 10.0.0.5:8085。',
      responseText: '建议继续观察 172.16.8.20 连通性。',
      rootCauseCol: '根因定位到 10.10.10.10 安全策略未放行。',
      problemTypeL1FinalCol: '产品使用',
      productSpec: '虚拟私有云',
      createdAt: '2026-08-04 10:00:00',
      ticketId: '20260804100000X123456789',
    }

    const out = processRow(row, true, { useRegex: true })

    expect(out).not.toBeNull()
    expect(out.rawText).toContain('192.168.1.10')
    expect(out.rawText).toContain('10.0.0.5:8085')
    expect(out.handlingText).toContain('192.168.1.10')
    expect(out.responseText).toContain('172.16.8.20')
    expect(out.sourceColumns?.['受理内容']).toContain('192.168.1.10')
    expect(out.sourceColumns?.['处理意见']).toContain('10.0.0.5:8085')
    expect(out.sourceColumns?.['问题原因']).toContain('10.10.10.10')
    expect(out.rawText).not.toContain('[IP已脱敏]')
    expect(JSON.stringify(out.sourceColumns || {})).not.toContain('[IP已脱敏]')
  })

  it('reprocessFeedbackRecord keeps plaintext imported content', () => {
    const fb = {
      id: 'r1',
      dataSourceType: 'complaint_ticket',
      product: '虚拟私有云',
      productSpec: '虚拟私有云',
      rawText: '客户反馈服务器 192.168.2.20 无法登录。',
      handlingText: '已指导客户检查堡垒机 10.2.2.2 访问控制。',
      customerQuote: '192.168.2.20 无法登录',
      responseText: '建议核对 172.20.0.8 放通策略。',
      requestScene: '咨询',
      problemType: '配额与权限申请',
      journeyL1: '产品订改续',
      journeyL2: '权限及配额限制',
      sentiment: 'neutral',
      themes: ['权限及配额限制'],
      problemSummary: '',
      painPoint: '',
      solutionSummary: '',
      rootCause: '10.2.2.2 策略未同步',
      optimizationSuggestion: '',
      status: 'open',
      importedAt: '2026-08-04T10:00:00.000Z',
      sourceColumns: {
        受理内容: '客户反馈服务器 192.168.2.20 无法登录。',
        处理意见: '已指导客户检查堡垒机 10.2.2.2 访问控制。',
        问题原因: '10.2.2.2 策略未同步',
      },
    }

    const out = reprocessFeedbackRecord(fb, { useRegex: true })

    expect(out.rawText).toContain('192.168.2.20')
    expect(out.handlingText).toContain('10.2.2.2')
    expect(out.sourceColumns?.['受理内容']).toContain('192.168.2.20')
    expect(out.sourceColumns?.['处理意见']).toContain('10.2.2.2')
    expect(out.sourceColumns?.['问题原因']).toContain('10.2.2.2')
    expect(out.rawText).not.toContain('[IP已脱敏]')
    expect(JSON.stringify(out.sourceColumns || {})).not.toContain('[IP已脱敏]')
  })
})
