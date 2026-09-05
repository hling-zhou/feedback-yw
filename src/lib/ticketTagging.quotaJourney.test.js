import { describe, expect, it } from 'vitest'
import { matchJourneyFromTextWithScore } from './ticketTagging.js'
import { EIP_USER_JOURNEY } from './journeys/eipJourney.js'
import { VPC_USER_JOURNEY } from './journeys/vpcJourney.js'
import { NAT_USER_JOURNEY } from './journeys/natJourney.js'
import { VPN_USER_JOURNEY } from './journeys/vpnJourney.js'
import { CC_USER_JOURNEY } from './journeys/ccJourney.js'
import { SLB_USER_JOURNEY } from './journeys/slbJourney.js'
import { DC_USER_JOURNEY } from './journeys/dcJourney.js'
import { MONITOR_USER_JOURNEY } from './journeys/monitorJourney.js'
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

  it('does not map freeze-while-still-subscribed onto unsubscribe', () => {
    const req =
      '订购弹性公网IP在云主机未退订且正常开通的情况被冻结，请协助排查原因'
    const handling = '带宽服务订单已到期，故被冻结，请在订单退订前及时续订。'
    const matched = matchJourneyFromTextWithScore(
      `${req}\n${handling}`,
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(matched.journeyL1).toBe('业务使用与连通')
    expect(matched.journeyL2).toBe('资源停用与冻结')
  })

  it('maps 外网不通请排查 to access, not investigate', () => {
    const matched = matchJourneyFromTextWithScore(
      'EIP外网不通，请协助排查原因',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(matched.journeyL1).toBe('业务使用与连通')
    expect(matched.journeyL2).toBe('公网访问不通')
  })

  it('maps EIP 业务中断 and 抓包 to operate, with no incident L1', () => {
    expect(EIP_USER_JOURNEY.some((l1) => l1.id === 'incident')).toBe(false)

    const outage = matchJourneyFromTextWithScore(
      '区域性大面积业务中断，EIP外网不通',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(outage.journeyL1).toBe('业务使用与连通')
    expect(outage.journeyL2).toBe('公网访问不通')

    const capture = matchJourneyFromTextWithScore(
      'EIP外网不通，请后台协查抓包',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(capture.journeyL1).toBe('业务使用与连通')
    expect(capture.journeyL2).toBe('公网访问不通')
  })

  it('still maps 未退订成功 to unsubscribe', () => {
    const matched = matchJourneyFromTextWithScore(
      'EIP未退订成功，一直提示退订失败，请帮忙退订',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(matched.journeyL1).toBe('退订与释放')
    expect(matched.journeyL2).toMatch(/退订/)
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

  it('maps SLB/DC ordinary 排查 to operate, not investigate', () => {
    const slb = matchJourneyFromTextWithScore(
      'SLB访问不通，请协助排查原因',
      SLB_USER_JOURNEY,
      'slb',
    )
    expect(slb.journeyL1).toBe('业务访问与质量')
    expect(slb.journeyL2).toBe('访问不通')

    const dc = matchJourneyFromTextWithScore(
      '专线不通，请协助排查',
      DC_USER_JOURNEY,
      'dc',
    )
    expect(dc.journeyL1).toBe('运行与质量')
    expect(dc.journeyL2).toBe('连通性异常')
  })

  it('maps SLB/DC 业务中断 and 抓包 to operate, with no incident L1', () => {
    expect(SLB_USER_JOURNEY.some((l1) => l1.id === 'incident')).toBe(false)
    expect(DC_USER_JOURNEY.some((l1) => l1.id === 'incident')).toBe(false)

    const slbOutage = matchJourneyFromTextWithScore(
      '业务中断，SLB访问不了',
      SLB_USER_JOURNEY,
      'slb',
    )
    expect(slbOutage.journeyL1).toBe('业务访问与质量')
    expect(slbOutage.journeyL2).toBe('访问不通')

    const slbCapture = matchJourneyFromTextWithScore(
      'SLB访问异常，请抓包',
      SLB_USER_JOURNEY,
      'slb',
    )
    expect(slbCapture.journeyL1).toBe('业务访问与质量')
    expect(slbCapture.journeyL2).toBe('访问不通')

    const dcOutage = matchJourneyFromTextWithScore(
      '专线业务中断，请尽快恢复',
      DC_USER_JOURNEY,
      'dc',
    )
    expect(dcOutage.journeyL1).toBe('运行与质量')
    expect(dcOutage.journeyL2).toBe('连通性异常')
  })

  it('keeps EIP/SLB/DC 报障 on operate, not service or consult', () => {
    const slow = matchJourneyFromTextWithScore(
      '数据上传突然很慢联系时间：9:00 — 18:00##产品名称：弹性公网IP',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(slow.journeyL1).toBe('业务使用与连通')
    expect(slow.journeyL2).toBe('网络质量与丢包')

    const flap = matchJourneyFromTextWithScore(
      '36.133.68.34 公网IP是时通时断联系时间：0:00 — 23:59##产品名称：弹性公网IP',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(flap.journeyL2).toBe('公网访问不通')

    const ipv6 = matchJourneyFromTextWithScore(
      'IPv6di地址2409:8c20:1833:39f0::a网络不通，帮忙排查',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(ipv6.journeyL2).toBe('公网访问不通')

    const bind = matchJourneyFromTextWithScore(
      '公网ip36.140.221.27绑定的内网ip 192.168.0.5 服务器 有时候能访问有时候不能访问',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(bind.journeyL2).toBe('公网访问不通')

    const bw = matchJourneyFromTextWithScore(
      '这个实例时100M 动态带宽，但是下载速度非常慢',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(bw.journeyL2).toBe('网络质量与丢包')

    const slb = matchJourneyFromTextWithScore(
      '弹性负载均衡监听器启动，网站无法访问了。',
      SLB_USER_JOURNEY,
      'slb',
    )
    expect(slb.journeyL2).toBe('访问不通')

    const dc = matchJourneyFromTextWithScore(
      '云专线异常，需要拉群协助排查',
      DC_USER_JOURNEY,
      'dc',
    )
    expect(dc.journeyL1).toBe('运行与质量')
    expect(dc.journeyL2).toBe('连通性异常')
  })

  it('does not tag 金牌模板 or 前置授权 as a journey', () => {
    const gold = matchJourneyFromTextWithScore(
      '<重要客户:金牌客户;内部重保客户;',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(gold.journeyL1).toBe('未识别环节')

    const auth = matchJourneyFromTextWithScore(
      '操作人： 移动云OP系统 追加内容： 前置授权',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(auth.journeyL1).toBe('未识别环节')
  })

  it('prefers EIP access over quality when both 打不开 and 慢', () => {
    const mixed = matchJourneyFromTextWithScore(
      '网站打不开，访问很卡顿',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(mixed.journeyL2).toBe('公网访问不通')

    const quality = matchJourneyFromTextWithScore(
      '周期性丢包，延迟高还有抖动',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(quality.journeyL2).toBe('网络质量与丢包')
  })

  it('maps 配额不够 to quantity and 控制台看不见IP to permission', () => {
    const quota = matchJourneyFromTextWithScore(
      '配额不够，配额没有增加',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(quota.journeyL2).toBe('配额与数量')

    const gray = matchJourneyFromTextWithScore(
      '控制台看不见这个IP，列表里也没有',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(gray.journeyL2).toBe('灰度与订购权限')
  })

  it('maps 收取带宽配额/出账 to billing, not provision', () => {
    const matched = matchJourneyFromTextWithScore(
      '已经出账，为什么还在收取带宽配额',
      EIP_USER_JOURNEY,
      'eip',
      { problemType: '配额与权限申请' },
    )
    expect(matched.journeyL1).toBe('认知与选型')
    expect(matched.journeyL2).toBe('计费模式咨询')

    const refund = matchJourneyFromTextWithScore(
      '带宽没有退订成功，现申请对带宽进行退订，同时将出账金额进行退回',
      EIP_USER_JOURNEY,
      'eip',
    )
    expect(refund.journeyL1).toBe('退订与释放')
  })

  it('maps DC 下单地域改不了 to provision, not connect', () => {
    const order = matchJourneyFromTextWithScore(
      '下单地域默认安徽改不了，接入节点也选不了',
      DC_USER_JOURNEY,
      'dc',
    )
    expect(order.journeyL1).toBe('开通与交付')
    expect(order.journeyL2).not.toBe('连通性异常')

    const connect = matchJourneyFromTextWithScore(
      '专线不通，ping 对端失败',
      DC_USER_JOURNEY,
      'dc',
    )
    expect(connect.journeyL2).toBe('连通性异常')
  })

  it('does not dump VPN/monitor 排查 into service', () => {
    const vpn = matchJourneyFromTextWithScore(
      'IPSec不通，请加急排查',
      VPN_USER_JOURNEY,
      'vpn',
    )
    expect(vpn.journeyL1).toBe('运行与故障排障')
    expect(vpn.journeyL2).not.toMatch(/催办|服务/)

    const monitor = matchJourneyFromTextWithScore(
      '监控数据不准确，请协查',
      MONITOR_USER_JOURNEY,
      'monitor',
    )
    expect(monitor.journeyL1).toBe('运行与故障排障')
    expect(monitor.journeyL2).toBe('监控数据异常')
  })
})
