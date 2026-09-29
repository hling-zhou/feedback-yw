import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { toActionRecsResult } from '../../src/lib/actionRecsMapper.js'

const require = createRequire(import.meta.url)
const {
  deriveDraftTax,
  draftBucketForRow,
  isQualityDraftPhrase,
  representativeDraftSub,
  runEngine,
} = require('./actionRecsEngine.cjs')

function ticket(partial) {
  return {
    product: '域名注册',
    ticketId: partial.ticketId,
    dataSourceType: 'consultation_ticket',
    importMonth: '2026-08',
    rootCause: partial.rootCause || '',
    painPoint: partial.painPoint || '',
    problemType: partial.problemType || '',
    journeyL1: partial.journeyL1 || '',
    journeyL2: partial.journeyL2 || '',
    urgencyLevel: '',
  }
}

describe('未预置产品草稿分类', () => {
  it('起步类目固定，不再用切词碎片当家族名', () => {
    const tax = deriveDraftTax('域名注册')
    expect(tax.derived).toBe(true)
    expect(tax.families.map((fam) => fam.name)).toEqual([
      '计费与续费',
      '开通与权限',
      '连通与配置',
      '说明与指引',
      '功能未开放',
      '待归类(草稿)',
    ])
  })

  it('短语质量线拒绝两字碎片', () => {
    expect(isQualityDraftPhrase('续费')).toBe(false)
    expect(isQualityDraftPhrase('入口')).toBe(false)
    expect(isQualityDraftPhrase('未开')).toBe(false)
    expect(isQualityDraftPhrase('无法自助续费')).toBe(true)
    expect(isQualityDraftPhrase('控制台入口不一致')).toBe(true)
  })

  it('有具体问题类型时按问题类型分桶，短旅程标签不单独成类', () => {
    expect(draftBucketForRow(ticket({
      ticketId: 'a',
      problemType: '配额与权限申请',
      journeyL2: '入口',
      rootCause: '客户无法在控制台找到授权码入口',
    })).name).toBe('配额与权限申请')

    expect(draftBucketForRow(ticket({
      ticketId: 'b',
      journeyL2: '续费',
      painPoint: '续费流程不透明，客户无法自助完成续费',
    })).name).toBe('计费与续费')

    expect(draftBucketForRow(ticket({
      ticketId: 'c',
      journeyL2: '迁移配置核对',
      painPoint: '迁移后价格计算器未给出报价',
    })).name).toBe('迁移配置核对')
  })

  it('卡片标题只保留类目名，完整句子留在痛点和根因', () => {
    const root = '客户无法在控制台找到授权码入口，导致迁移无法自助完成'
    const pain = '客户对操作路径存在困惑，且备案与迁移的关联说明不清晰'
    const rows = Array.from({ length: 6 }, (_, index) => ticket({
      ticketId: `t${index}`,
      problemType: '配额与权限申请',
      journeyL2: '入口',
      rootCause: root,
      painPoint: pain,
    }))
    rows.push(ticket({
      ticketId: 'tail',
      journeyL2: '续费',
      painPoint: '续费流程不透明，客户无法自助完成续费申请',
      rootCause: '续费需先新建信息模版并等待审核，流程不透明导致续费延迟',
    }))

    const { summary } = runEngine(rows, { disableOverrides: true, productScope: ['域名注册'] })
    const product = summary.find((item) => item.p === '域名注册')
    expect(product.derived).toBe(true)
    const cards = product.items.map((item) => toActionRecsResult(item, product, 'consultation_ticket'))
    const titles = cards.map((card) => card.summary)
    expect(titles).toContain('配额与权限申请')
    expect(titles).toContain('计费与续费')
    expect(titles.some((title) => title.includes('·'))).toBe(false)
    const quota = cards.find((card) => card.summary === '配额与权限申请')
    expect(quota.problemSummary.root).toBe(root)
    expect(quota.problemSummary.pain).toBe(pain)
  })

  it('代表句跳过未定位套话', () => {
    const label = representativeDraftSub([
      ticket({
        ticketId: 'u1',
        rootCause: '工单未定位到具体问题原因',
        painPoint: '普通企业账号无法通过官网自助订购云互联，订购入口受限',
      }),
    ])
    expect(label).toContain('普通企业账号无法通过官网自助订购')
  })
})
