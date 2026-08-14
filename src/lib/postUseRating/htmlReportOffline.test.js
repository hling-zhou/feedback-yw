import { describe, expect, it } from 'vitest'
import { buildPostUseStoryModel } from './storyModel.js'
import { buildHtmlMonthlyReportModel } from './htmlReportModel.js'
import {
  buildOfflineMonthlyReportHtml,
  offlineMonthlyReportFilename,
} from './htmlReportOffline.js'

const period = {
  id: 'period:month:2026-06',
  label: '2026年6月',
  endDate: '2026-06-30',
  granularity: 'month',
  anchorYear: 2026,
}

describe('offline monthly report html', () => {
  it('builds a self-contained snapshot that opens without the app', () => {
    const records = [
      {
        id: 'r0',
        dataSourceType: 'post_use_rating',
        productName: '弹性公网IP',
        ratingScore: 8,
        channel: 'sms',
        importMonth: '2026-06',
        commentText: '网都上不了',
        customerName: '客户0',
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `r${index + 1}`,
        dataSourceType: 'post_use_rating',
        productName: '弹性公网IP',
        ratingScore: 10,
        channel: 'sms',
        importMonth: '2026-06',
        commentText: index === 0 ? '用着很稳定' : '',
        customerName: `客户${index + 1}`,
      })),
    ]
    const storyModel = buildPostUseStoryModel({
      records,
      allRecords: records,
      productNames: ['弹性公网IP'],
      period,
    })
    const model = buildHtmlMonthlyReportModel({
      reportMonth: '2026-06',
      storyModel,
      records,
    })
    const html = buildOfflineMonthlyReportHtml({
      model,
      judgment: '人工总判断：先看弹性公网IP',
      todoNote: '先办回访',
      issueNarratives: {
        [model.issues[0]?.key]: { conclusion: '要管', action: '回访' },
      },
      exportedAt: '2026-08-14T02:00:00.000Z',
    })

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8"')
    expect(html).not.toMatch(/<script\s+src=/)
    expect(html).not.toMatch(/href="https?:\/\//)
    expect(html).toContain('<style>')
    expect(html).toContain('离线快照')
    expect(html).toContain('本月判断')
    expect(html).toContain('与公司均分持平')
    expect(html).toContain('暂无上月对比')
    expect(html).toContain('人工总判断：先看弹性公网IP')
    expect(html).toContain('网都上不了')
    expect(html).toContain('正反馈')
    expect(html).toContain('负反馈')
    expect(html).toContain('<svg')
    expect(html).toContain('附录')
    expect(offlineMonthlyReportFilename('2026-06')).toBe('用后即评月报-2026-06.html')
  })
})
