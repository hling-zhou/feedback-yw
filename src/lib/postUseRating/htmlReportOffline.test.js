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
    expect(html).toContain('本月概述')
    expect(html).toContain('待办事项及进展')
    expect(html).not.toContain('待办事情及进展')
    expect(html).toContain('部门均分（三渠道）')
    expect(html).not.toContain('云网均分（三渠道）')
    expect(html).toContain('上期客服部回访结果补充')
    expect(html).not.toContain('<textarea')
    expect(html).toContain('与公司均分持平')
    expect(html).toContain('暂无上月对比')
    expect(html).toContain('人工总判断：先看弹性公网IP')
    expect(html).toContain('网都上不了')
    expect(html).toContain('正反馈')
    expect(html).toContain('负反馈')
    expect(html).toContain('<svg')
    expect(html).toContain('附录')
    expect(html).toContain('report-product-layout')
    expect(html).toContain('report-product-list__item')
    expect(html).toContain('data-product-tab=')
    expect(html).toContain('data-product-panel=')
    // 单产品三层结构 + 随屏导航 + 悬浮目录
    expect(html).toContain('report-group-title')
    expect(html).toContain('评分概览')
    expect(html).toContain('负反馈详情及建议举措')
    expect(html).toContain('建议举措')
    expect(html).not.toContain('建议动作')
    expect(html).toContain('report-product-nav__item')
    expect(html).toContain('report-toc')
    expect(html).toContain('data-toc-product=')
    expect(html).not.toContain('重点产品体验均分趋势')
    expect(html).not.toContain('重点产品投诉回访满意度趋势')
    expect(offlineMonthlyReportFilename('2026-06')).toBe('用后即评月报-2026-06.html')
  })

  it('renders todo items as a read-only list inside the todo section', () => {
    const records = [
      {
        id: 'r0',
        dataSourceType: 'post_use_rating',
        productName: '弹性公网IP',
        ratingScore: 9.2,
        channel: 'sms',
        importMonth: '2026-06',
      },
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
      judgment: '带待办清单',
      todoNote: '备注保留',
      todoItems: [
        { id: 'todo-1', content: '推动 SSL VPN 弹性带宽', owner: '张三', team: '云网一组', source: 'manual' },
        { id: 'todo-2', content: '', owner: '', team: '', source: 'manual' },
      ],
      exportedAt: '2026-10-17T00:00:00.000Z',
    })
    expect(html).toContain('待办事项及进展')
    expect(html).toContain('推动 SSL VPN 弹性带宽')
    expect(html).toContain('张三')
    expect(html).toContain('云网一组')
    expect(html).toContain('备注保留')
    expect(html).not.toContain('暂无待办事项')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<select')
  })

  it('keeps overview trend combined and exposes offline interactions', () => {
    const records = [
      {
        id: 'r0',
        dataSourceType: 'post_use_rating',
        productName: '弹性公网IP',
        ratingScore: 9.2,
        channel: 'sms',
        importMonth: '2026-06',
      },
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
    model.charts.statusTrend = {
      data: [
        { date: '2026-04', departmentScore: 9.2, departmentRate: null },
        { date: '2026-05', departmentScore: null, departmentRate: 90 },
        { date: '2026-06', departmentScore: 9.4, departmentRate: 88 },
      ],
      areas: [
        { dataKey: 'departmentScore', name: '部门体验均分', stroke: '#2563EB', yAxisId: 'score' },
        { dataKey: 'departmentRate', name: '部门投诉回访满意度', stroke: '#059669', yAxisId: 'rate' },
      ],
    }
    const html = buildOfflineMonthlyReportHtml({ model, judgment: '轴与悬停', exportedAt: '2026-10-17T00:00:00.000Z' })
    expect(html).toContain('data-product-tab=')
    expect(html).toContain('offline-chart-tooltip')
    expect(html).toContain('data-tooltip="2026-06 部门体验均分 9.4"')
    expect(html).toContain('部门投诉回访满意度')
    expect(html).toContain('达标线 88%')
    expect(html).toContain('关注线 9')
    expect(html).not.toContain('均分趋势（关注线 9）')
    expect(html).not.toContain('投诉回访满意度（达标线 88%）')
  })
})
