import { describe, expect, it } from 'vitest'
import { tagTicketDimensions } from './ticketDimensionTagging.js'
import { getTaxonomy } from '../productTaxonomy.js'
import { setCorrectionRulesCache } from '../learning/tagCorrectionRules.js'

const EXAMPLE1_TEXT = [
  '系统路径：undefined--弹性公网IP--产品使用问题--公网IP绑定/解绑失败',
  '详细内容：首处理&应用一组：客户反馈EIP已绑定成功，但外网访问8085端口不通。',
  '协办&网络安全组：抓包显示安全组入方向仅放行80端口，未放行8085，已指导客户添加规则后恢复。',
  '客户原话：“业务急着上线，端口一直不通，麻烦尽快放开。”',
].join('\n')

const EXAMPLE2_TEXT = [
  '系统路径：undefined--云专线--故障报修--可用性/连通性',
  '详细内容：开始&客服组：客户反馈专线不通，请排查。协办&网络组：已联系客户，客户表示稍后提供拓扑。',
  '反馈&客服组：客户暂未回复，工单保留。',
].join('\n')

describe('tagTicketDimensions (P2a)', () => {
  it('example1: content-first scene/problem, path does not override clear content', () => {
    const tax = getTaxonomy('弹性公网IP', 'eip')
    const dims = tagTicketDimensions({
      text: EXAMPLE1_TEXT,
      input: { rawText: EXAMPLE1_TEXT, handlingText: EXAMPLE1_TEXT },
      taxonomy: tax,
      taxonomyKey: 'eip',
    })

    expect(dims.requestScene).toBe('报障与排错')
    expect(dims.problemType).toMatch(/配置与操作|可用性\/连通性故障/)
    expect(dims.journeyL2).toMatch(/访问控制|白名单/)
  })

  it('example2: fuzzy content uses path fallback for scene/problem, journey stays unrecognized', () => {
    const tax = getTaxonomy('云专线', 'dc')
    const dims = tagTicketDimensions({
      text: EXAMPLE2_TEXT,
      input: { rawText: EXAMPLE2_TEXT, handlingText: EXAMPLE2_TEXT },
      taxonomy: tax,
      taxonomyKey: 'dc',
    })

    expect(dims.requestScene).toBe('报障与排错')
    expect(dims.problemType).toBe('可用性/连通性故障')
    expect(dims.journeyL1).toBe('无法识别')
    expect(dims.journeyL2).toBe('无法识别')
  })

  it('content wins over path when both differ and content is recognized', () => {
    const tax = getTaxonomy('弹性公网IP', 'eip')
    const text = [
      '系统路径：undefined--弹性公网IP--产品使用问题--公网IP绑定/解绑失败',
      '详细内容：客户咨询弹性公网IP是否支持IPv6双栈绑定。',
    ].join('\n')

    const dims = tagTicketDimensions({
      text,
      input: { rawText: text, handlingText: text },
      taxonomy: tax,
      taxonomyKey: 'eip',
    })

    expect(dims.requestScene).toMatch(/产品信息咨询|操作指导/)
    expect(dims.requestScene).not.toBe('报障与排错')
  })

  it('uses extracted customerRequest for journey when handling text is empty', () => {
    const tax = getTaxonomy('弹性公网IP', 'eip')
    const dims = tagTicketDimensions({
      text: '无',
      input: {
        handlingText: '无',
        customerRequest: '需要将西南-成都单资源池带宽配额提升至5120M。',
      },
      taxonomy: tax,
      taxonomyKey: 'eip',
    })

    expect(dims.problemType).toBe('配额与权限申请')
    expect(dims.journeyL1).toMatch(/开通与申领|产品订改续/)
    expect(dims.journeyL2).toMatch(/配额|权限及配额/)
    expect(dims.journeyL2).not.toMatch(/升降配|变更其他|灰度/)
  })

  it('does not classify plain bandwidth change as quota', () => {
    const tax = getTaxonomy('弹性公网IP', 'eip')
    const dims = tagTicketDimensions({
      text: '申请调整带宽到100M',
      input: { customerRequest: '申请调整带宽到100M' },
      taxonomy: tax,
      taxonomyKey: 'eip',
    })
    expect(dims.problemType).not.toBe('配额与权限申请')
    expect(dims.journeyL2).toBe('带宽升降配')
  })

  it('pins VPC gray apply to permission even when az words are present', () => {
    const tax = getTaxonomy('虚拟私有云', 'vpc')
    const req = '灰度申请，子网灰掉选不了华东苏州'
    const dims = tagTicketDimensions({
      text: req,
      input: { customerRequest: req },
      taxonomy: tax,
      taxonomyKey: 'vpc',
    })
    expect(dims.problemType).toBe('配额与权限申请')
    expect(dims.journeyL2).toBe('灰度与订购权限')
  })

  it('does not treat EIP freeze-while-still-subscribed as unsubscribe', () => {
    const tax = getTaxonomy('弹性公网IP', 'eip')
    const req =
      '保山市隆阳区妇幼保健院订购弹性公网IP在云主机未退订且正常开通的情况被冻结，移动云账号也正常开通，请协助排查原因   加急加急'
    const handling =
      '经查询您移动云账号下有一笔带宽服务订单已到期，故被冻结，若您仍有需要，请您在订单退订前及时续订订单。'
    const dims = tagTicketDimensions({
      text: `${req}\n【处理意见】\n${handling}`,
      input: { customerRequest: req, handlingText: handling, rawText: `${req}\n${handling}` },
      taxonomy: tax,
      taxonomyKey: 'eip',
    })
    expect(dims.requestScene).toBe('报障与排错')
    expect(dims.problemType).toBe('可用性/连通性故障')
    expect(dims.journeyL1).toBe('业务使用与连通')
    expect(dims.journeyL2).toBe('资源停用与冻结')
  })

  it('maps CC order permission to 灰度与订购权限', () => {
    const tax = getTaxonomy('云组网', 'cc')
    const req = '申请提升订购权限至8G，接入带宽'
    const dims = tagTicketDimensions({
      text: req,
      input: { customerRequest: req },
      taxonomy: tax,
      taxonomyKey: 'cc',
    })
    expect(dims.problemType).toBe('配额与权限申请')
    expect(dims.journeyL2).toBe('灰度与订购权限')
  })

  it('does not use 金牌模板 as a journey even with a path', () => {
    const tax = getTaxonomy('弹性公网IP', 'eip')
    const req = '<重要客户:金牌客户;内部重保客户;'
    const dims = tagTicketDimensions({
      text: `系统路径：undefined--弹性公网IP--故障报修--可用性/连通性\n详细内容：${req}`,
      input: { customerRequest: req, rawText: req },
      taxonomy: tax,
      taxonomyKey: 'eip',
      settings: { useRequestNodeForJourney: true },
    })
    expect(dims.journeyL1).toBe('无法识别')
    expect(dims.journeyL2).toBe('无法识别')
  })

  it('maps EIP 时通时断 to access, not service', () => {
    const tax = getTaxonomy('弹性公网IP', 'eip')
    const req = '36.133.68.34 公网IP是时通时断联系时间：0:00 — 23:59##产品名称：弹性公网IP'
    const dims = tagTicketDimensions({
      text: req,
      input: { customerRequest: req },
      taxonomy: tax,
      taxonomyKey: 'eip',
    })
    expect(dims.journeyL1).toBe('业务使用与连通')
    expect(dims.journeyL2).toBe('公网访问不通')
  })

  it('maps VPN gray permission to 灰度与订购权限', () => {
    const tax = getTaxonomy('融合VPN', 'vpn')
    const req = '申请开通SSL VPN，灰度权限'
    const dims = tagTicketDimensions({
      text: req,
      input: { customerRequest: req },
      taxonomy: tax,
      taxonomyKey: 'vpn',
    })
    expect(dims.problemType).toBe('配额与权限申请')
    expect(dims.journeyL2).toBe('灰度与订购权限')
  })

  it('applies approved correction overlay after the decision tree', () => {
    setCorrectionRulesCache([
      {
        id: 'overlay-scene',
        dimension: 'requestScene',
        fromLabel: '报障与排错',
        toLabel: '产品信息咨询',
        keywords: ['8085'],
        evidenceCount: 3,
        status: 'approved',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const tax = getTaxonomy('弹性公网IP', 'eip')
    const dims = tagTicketDimensions({
      text: EXAMPLE1_TEXT,
      input: { rawText: EXAMPLE1_TEXT, handlingText: EXAMPLE1_TEXT },
      taxonomy: tax,
      taxonomyKey: 'eip',
    })
    expect(dims.requestScene).toBe('产品信息咨询')
    setCorrectionRulesCache([])
  })

  it('skips overlay when skipCorrectionOverlay is set', () => {
    setCorrectionRulesCache([
      {
        id: 'overlay-scene',
        dimension: 'requestScene',
        fromLabel: '报障与排错',
        toLabel: '产品信息咨询',
        keywords: ['8085'],
        evidenceCount: 3,
        status: 'approved',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const tax = getTaxonomy('弹性公网IP', 'eip')
    const dims = tagTicketDimensions({
      text: EXAMPLE1_TEXT,
      input: { rawText: EXAMPLE1_TEXT, handlingText: EXAMPLE1_TEXT },
      taxonomy: tax,
      taxonomyKey: 'eip',
      settings: { skipCorrectionOverlay: true },
    })
    expect(dims.requestScene).toBe('报障与排错')
    setCorrectionRulesCache([])
  })
})
