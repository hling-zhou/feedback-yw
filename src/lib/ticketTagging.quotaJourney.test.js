import { describe, expect, it } from 'vitest'
import { matchJourneyFromTextWithScore } from './ticketTagging.js'
import { EIP_USER_JOURNEY } from './journeys/eipJourney.js'
import { VPC_USER_JOURNEY } from './journeys/vpcJourney.js'
import { NAT_USER_JOURNEY } from './journeys/natJourney.js'
import { VPN_USER_JOURNEY } from './journeys/vpnJourney.js'
import { CC_USER_JOURNEY } from './journeys/ccJourney.js'
import { getTaxonomy } from './productTaxonomy.js'

describe('quota journey matching', () => {
  const samples = [
    '需要将西南-成都单资源池带宽配额提升至5120M。',
    '客户申请提升华中长沙2资源池带宽配额',
    '金牌客户申请全局资源池带宽配额提升至15360M',
  ]

  it('maps bandwidth quota requests to the quota node, not bandwidth change', () => {
    for (const text of samples) {
      const matched = matchJourneyFromTextWithScore(text, EIP_USER_JOURNEY, 'eip')
      expect(matched.journeyL1).toBe('开通与申领')
      expect(matched.journeyL2).toBe('配额与数量')
    }
  })

  it('maps quota requests on the loaded EIP catalog to the quota child', () => {
    const tax = getTaxonomy('弹性公网IP', 'eip')
    for (const text of samples) {
      const matched = matchJourneyFromTextWithScore(text, tax.journeys, 'eip', {
        problemType: '配额与权限申请',
      })
      expect(matched.journeyL1).toMatch(/开通与申领|产品订改续/)
      expect(matched.journeyL2).toMatch(/配额/)
      expect(matched.journeyL2).not.toMatch(/升降配|变更其他/)
    }
  })

  it('keeps plain bandwidth change on the bandwidth node', () => {
    for (const text of ['申请调整带宽到100M', '申请把西南-成都带宽提升到5120M']) {
      const matched = matchJourneyFromTextWithScore(text, EIP_USER_JOURNEY, 'eip')
      expect(matched.journeyL2, text).toBe('带宽升降配')
    }
  })

  it('pins VPC gray apply plus az wording to permission, not az select', () => {
    const matched = matchJourneyFromTextWithScore(
      '灰度申请，子网灰掉选不了华东苏州',
      VPC_USER_JOURNEY,
      'vpc',
      { problemType: '配额与权限申请' },
    )
    expect(matched.journeyL1).toBe('创建与基础资源')
    expect(matched.journeyL2).toBe('灰度与订购权限')
  })

  it('splits EIP quantity quota and gray permission', () => {
    const quota = matchJourneyFromTextWithScore(
      '申请提升公网IP全局配额至300个',
      EIP_USER_JOURNEY,
      'eip',
      { problemType: '配额与权限申请' },
    )
    expect(quota.journeyL2).toBe('配额与数量')

    const permission = matchJourneyFromTextWithScore(
      '开通8:1灰度权限，取消CPU与IP比例限制',
      EIP_USER_JOURNEY,
      'eip',
      { problemType: '配额与权限申请' },
    )
    expect(permission.journeyL2).toBe('灰度与订购权限')
  })

  it('keeps VPC az-only complaints on az select', () => {
    const matched = matchJourneyFromTextWithScore(
      '子网灰掉选不了华东苏州',
      VPC_USER_JOURNEY,
      'vpc',
    )
    expect(matched.journeyL2).toBe('可用区与子网选择')
  })

  it('splits NAT quantity quota and gray permission', () => {
    const quota = matchJourneyFromTextWithScore(
      'NAT网关个数配额已满，申请提升配额',
      NAT_USER_JOURNEY,
      'nat',
      { problemType: '配额与权限申请' },
    )
    expect(quota.journeyL2).toBe('配额与实例数')

    const gray = matchJourneyFromTextWithScore(
      '烦请上架，加下灰度，申请订购权限',
      NAT_USER_JOURNEY,
      'nat',
      { problemType: '配额与权限申请' },
    )
    expect(gray.journeyL2).toBe('灰度与订购权限')
  })

  it('maps VPN gray permission to the permission node, not spec quota', () => {
    const matched = matchJourneyFromTextWithScore(
      '申请开通SSL VPN，灰度权限',
      VPN_USER_JOURNEY,
      'vpn',
      { problemType: '配额与权限申请' },
    )
    expect(matched.journeyL2).toBe('灰度与订购权限')
  })

  it('splits CC quantity quota and order permission', () => {
    const quota = matchJourneyFromTextWithScore(
      '申请提升云组网条数配额至20条',
      CC_USER_JOURNEY,
      'cc',
      { problemType: '配额与权限申请' },
    )
    expect(quota.journeyL2).toBe('配额与数量')

    const permission = matchJourneyFromTextWithScore(
      '申请提升订购权限至8G，接入带宽',
      CC_USER_JOURNEY,
      'cc',
      { problemType: '配额与权限申请' },
    )
    expect(permission.journeyL2).toBe('灰度与订购权限')
  })
})
