import { describe, expect, it, vi } from 'vitest'
import { buildHtmlMonthlyReportModel } from './htmlReportModel.js'
import { mergeGeneratedReportDraft, pendingReportProductDrafts, runReportDraftQueue } from './reportDraftAuto.js'
import { buildPostUseStoryModel } from './storyModel.js'

const card = (productName, evidenceFingerprint) => ({
  productName, evidenceFingerprint, narrative: { facts: { productName } }, conclusionKey: `product:${productName}`,
})

describe('automatic report draft queue', () => {
  it('preserves an in-progress conclusion edit and a saved manual action', () => {
    const merged = mergeGeneratedReportDraft(
      { 'product:NAT网关': { conclusion: '正在输入的结论', action: '原举措' } },
      'product:NAT网关',
      { conclusion: 'AI 结论', action: 'AI 举措' },
      { action: '已保存的人工举措' },
      { conclusion: true },
    )
    expect(merged['product:NAT网关']).toEqual({ conclusion: '正在输入的结论', action: '已保存的人工举措' })
  })

  it('accepts product cards built from a real monthly report record', async () => {
    const records = [{
      id: 'nat-rating-1', dataSourceType: 'post_use_rating', productName: 'NAT网关',
      ratingScore: 1, channel: 'console', importMonth: '2026-06',
      rawText: '性能监控缺少带宽利用率指标', customerName: '客户甲',
    }]
    const period = { id: 'period:month:2026-06', label: '2026年6月', endDate: '2026-06-30', granularity: 'month', anchorYear: 2026 }
    const storyModel = buildPostUseStoryModel({ records, allRecords: records, productNames: ['NAT网关'], focusNames: ['NAT网关'], actions: [], period })
    const model = buildHtmlMonthlyReportModel({ reportMonth: '2026-06', storyModel, records, productNames: ['NAT网关'] })
    expect(model.productCards).toHaveLength(1)

    const save = vi.fn(async (_key, productName, fingerprint, draft) => ({ item: { productName, fingerprint, ...draft } }))
    const result = await runReportDraftQueue({
      cards: model.productCards, savedDrafts: [], reportKey: '2026-06', settings: {},
      isCurrent: () => true,
      generate: async () => ({ detail: '完整详情', action: '核查指标并验收', conclusion: '继续关注指标补齐' }),
      save,
    })
    expect(result).toMatchObject({ completed: 1, total: 1, failures: [] })
    expect(save).toHaveBeenCalledWith('2026-06', 'NAT网关', model.productCards[0].evidenceFingerprint, expect.objectContaining({ detail: '完整详情' }))
  })

  it('reuses current drafts and processes remaining products in order after one fails', async () => {
    const cards = [card('已保存', 'same'), card('失败产品', 'new'), card('成功产品', 'new')]
    const savedDrafts = [{ productName: '已保存', fingerprint: 'same' }, { productName: '失败产品', fingerprint: 'old' }]
    expect(pendingReportProductDrafts(cards, savedDrafts).map((row) => row.productName)).toEqual(['失败产品', '成功产品'])

    const generated = []
    const saved = []
    const progress = []
    const result = await runReportDraftQueue({
      cards, savedDrafts, reportKey: '2026-Q3', settings: {}, isCurrent: () => true,
      generate: async (_settings, narrative) => {
        generated.push(narrative.facts.productName)
        if (narrative.facts.productName === '失败产品') throw new Error('模型输出截断')
        return { detail: '详情', action: '举措', conclusion: '结论' }
      },
      save: async (reportKey, productName, fingerprint, draft) => {
        saved.push({ reportKey, productName, fingerprint, draft })
        return { item: { productName, fingerprint, ...draft } }
      },
      onProgress: (state) => progress.push(state),
    })

    expect(generated).toEqual(['失败产品', '成功产品'])
    expect(saved).toEqual([{ reportKey: '2026-Q3', productName: '成功产品', fingerprint: 'new', draft: { detail: '详情', action: '举措', conclusion: '结论' } }])
    expect(result).toEqual({ completed: 2, total: 2, failures: [{ productName: '失败产品', message: '模型输出截断' }] })
    expect(progress.at(-1)).toEqual(result)
  })

  it('does not save an old result after the report changes', async () => {
    let current = true
    const save = vi.fn()
    const result = await runReportDraftQueue({
      cards: [card('产品甲', 'fingerprint-a')], savedDrafts: [], reportKey: '2026-08', settings: {},
      isCurrent: () => current,
      generate: async () => {
        current = false
        return { detail: '旧结果', action: '旧举措', conclusion: '旧结论' }
      },
      save,
    })
    expect(save).not.toHaveBeenCalled()
    expect(result.completed).toBe(0)
  })
})
