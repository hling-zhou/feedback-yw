import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildMonthlyReportDocxBlob } from './monthlyReportDocx.js'
import {
  analyzeMonthlyReportRevisionLearning,
  importMonthlyReportDocx,
  upsertMonthlyReportLearnings,
  loadMonthlyReportLearnings,
} from './monthlyReportDocxImport.js'

describe('monthlyReportDocxImport', () => {
  it('imports key tables from system-generated monthly report docx', async () => {
    const blob = await buildMonthlyReportDocxBlob({
      title: '用后即评月报（2026.6）',
      overview: {
        note: 'test',
        productCount: 1,
        totalSample: 10,
        avgScore: 9.9,
        belowNineCount: 0,
        belowNineRatio: 0,
        companyAvg: 9.8,
        companySample: 20,
      },
      onlineModel: { quality: null, ruleVersion: 'v1' },
      satisfaction: { notQualified: [] },
      monthlyScoreTable: [
        { productName: '弹性公网IP', sampleSize: 10, avgScore: 9.9, callbackTenPointRate: 90 },
      ],
      productExperience: [],
      sceneJourneys: [],
      needs: [],
      customers: [],
      issueChanges: [],
      scoreDistributionTable: [
        { productName: '弹性公网IP', sampleSize: 10, 10: 9, 9: 1, 8: 0, 7: 0, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      ],
      visitMonth: '2026-06',
      visits: [],
      visitsDetailed: [
        {
          id: 'v1',
          userFeedbackText: '希望支持跨用户变更',
          userInfoDetail: '客户A',
          visitFeedbackDetail: '已完成电话回访',
          internalEvaluationDetail: '建议进入需求池',
        },
      ],
      reasons: [],
      actionsProposed: [],
      actionsClosed: [],
      actionMappings: [],
      completedButNotRecovered: [],
    })

    const file = new File([blob], '用后即评月报-2026-06.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const imported = await importMonthlyReportDocx(file)

    expect(imported.reportMonth).toBe('2026-06')
    expect(imported.monthlyScoreTable[0]).toMatchObject({
      productName: '弹性公网IP',
      sampleSize: 10,
      avgScore: 9.9,
      callbackTenPointRate: 90,
    })
    expect(imported.scoreDistributionTable[0]).toMatchObject({
      productName: '弹性公网IP',
      10: 9,
      9: 1,
    })
    expect(imported.visitsDetailed[0]).toMatchObject({
      userFeedbackText: '希望支持跨用户变更',
      userInfoDetail: '客户A',
      visitFeedbackDetail: '已完成电话回访',
      internalEvaluationDetail: '建议进入需求池',
    })
  })

  it('builds revision learnings and stores them as a reusable library', async () => {
    const currentModel = {
      reportMonth: '2026-06',
      monthlyScoreTable: [
        { productName: '弹性公网IP', sampleSize: 10, avgScore: 9.9, callbackTenPointRate: 90 },
      ],
      scoreDistributionTable: [
        { productName: '弹性公网IP', sampleSize: 10, 10: 9, 9: 1, 8: 0, 7: 0, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      ],
      visitsDetailed: [],
    }
    const revision = {
      id: 'rev-1',
      reportMonth: '2026-06',
      monthlyScoreTable: [
        { productName: '弹性公网IP', sampleSize: 11, avgScore: 9.8, callbackTenPointRate: 90 },
      ],
      scoreDistributionTable: [
        { productName: '弹性公网IP', sampleSize: 11, 10: 9, 9: 1, 8: 1, 7: 0, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      ],
      visitsDetailed: [
        {
          id: 'v1',
          userFeedbackText: '希望支持跨用户变更',
          userInfoDetail: '客户A',
          visitFeedbackDetail: '已完成电话回访',
          internalEvaluationDetail: '建议进入需求池',
        },
      ],
    }
    const analysis = analyzeMonthlyReportRevisionLearning({ currentModel, revision })

    expect(analysis.comparison.differenceCount).toBeGreaterThan(0)
    expect(analysis.learnings.map((item) => item.section)).toEqual(['2.1', '2.3', '3.1'])

    const meta = new Map()
    const adapter = {
      getMeta: async (key) => meta.get(key),
      putMeta: async (key, value) => meta.set(key, value),
    }
    await upsertMonthlyReportLearnings(adapter, analysis.learnings)
    const stored = await loadMonthlyReportLearnings(adapter)

    expect(stored).toHaveLength(3)
    expect(stored[0]).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        recommendation: expect.any(String),
        hitCount: 1,
      }),
    )
  })

  it('renders stored learnings into future Word exports', async () => {
    const blob = await buildMonthlyReportDocxBlob({
      title: '用后即评月报（2026.6）',
      overview: {
        note: 'test',
        productCount: 1,
        totalSample: 10,
        avgScore: 9.9,
        belowNineCount: 0,
        belowNineRatio: 0,
        companyAvg: 9.8,
        companySample: 20,
      },
      onlineModel: { quality: null, ruleVersion: 'v1' },
      satisfaction: { notQualified: [] },
      monthlyScoreTable: [],
      productExperience: [],
      sceneJourneys: [],
      needs: [],
      customers: [],
      issueChanges: [],
      scoreDistributionTable: [],
      reviewChecklist: [
        {
          section: '2.1',
          sectionLabel: '2.1 整体得分情况',
          title: '导出前复核 2.1 产品总表',
          recommendation: '优先核查 2.1 产品名、样本量、得分与投诉回访满意比。',
          hitCount: 2,
        },
      ],
      visitMonth: '2026-06',
      visits: [],
      visitsDetailed: [],
      reasons: [],
      actionsProposed: [],
      actionsClosed: [],
      actionMappings: [],
      completedButNotRecovered: [],
    })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')?.async('string')

    expect(xml).toContain('报告复核提示')
    expect(xml).toContain('导出前复核 2.1 产品总表')
    expect(xml).toContain('命中次数')
  })
})
