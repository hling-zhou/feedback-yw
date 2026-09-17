import { describe, expect, it } from 'vitest'
import { matchJourneyFromTextWithScore } from './ticketTagging.js'
import { VPC_USER_JOURNEY } from './journeys/vpcJourney.js'
import { EIP_USER_JOURNEY } from './journeys/eipJourney.js'
import { DC_USER_JOURNEY } from './journeys/dcJourney.js'

const JOURNEYS = { vpc: VPC_USER_JOURNEY, eip: EIP_USER_JOURNEY, dc: DC_USER_JOURNEY }

function match(key, text) {
  const result = matchJourneyFromTextWithScore(text, JOURNEYS[key], key)
  return { l1: result.journeyL1, l2: result.journeyL2 }
}

describe('连通性与时延链路质量的判据边界', () => {
  it('纯连通症状落到连通节点', () => {
    expect(match('vpc', '客户两台云主机内网不通')).toEqual({
      l1: '业务连通与运行',
      l2: '内网互通异常',
    })
  })

  it('连通症状 + 质量度量词（混合）按质量归口', () => {
    expect(match('vpc', '客户两台云主机内网不通，丢包严重')).toEqual({
      l1: '业务连通与运行',
      l2: '时延与链路质量',
    })
  })

  it('慢类体验词不触发质量归口：打不开仍归访问不通', () => {
    expect(match('vpc', '客户反馈无法访问，而且很慢').l2).toBe('内网互通异常')
    expect(match('eip', '网站打不开，访问很卡顿').l2).toBe('公网访问不通')
  })

  it('建连层超时属可达性失败，仍落连通节点', () => {
    expect(match('vpc', '客户反馈VPC内主机不通，连接超时').l2).toBe('内网互通异常')
  })

  it('响应层超时归质量节点', () => {
    expect(match('eip', '客户反馈公网不通，响应超时')).toEqual({
      l1: '业务使用与连通',
      l2: '网络质量与丢包',
    })
  })

  it('否定式质量词不算质量信号（不丢包也不延迟）', () => {
    expect(match('eip', '不丢包也不延迟，就是访问不了').l2).toBe('公网访问不通')
  })

  it('否定后另有断言时仍算质量信号（不丢包，但延迟高）', () => {
    expect(match('eip', '客户反馈不丢包，但延迟高，访问慢').l2).toBe('网络质量与丢包')
  })

  it('「不稳定」等扩展度量词同样触发质量归口', () => {
    expect(match('vpc', '客户反馈无法访问，且网络不稳定').l2).toBe('时延与链路质量')
  })

  it('连通方向决定落到内网还是公网节点', () => {
    expect(match('vpc', '客户反馈公网无法访问，出网异常').l2).toBe('出网与入网异常')
  })

  it('纯质量表述不进连通节点', () => {
    expect(match('eip', '丢包严重，请排查').l2).toBe('网络质量与丢包')
    expect(match('dc', '专线慢，比公网慢').l2).toBe('时延慢与卡顿')
  })

  it('同 L1 多个质量节点时按关键词证据选点', () => {
    expect(match('dc', '专线不通，丢包严重').l2).toBe('丢包与链路质量')
    expect(match('dc', '专线不通，延迟高卡顿').l2).toBe('时延慢与卡顿')
  })

  it('不越 L1：带宽配额诉求不被质量判据抢走', () => {
    expect(match('vpc', '客户需要提升带宽配额，网络很慢')).toEqual({
      l1: '创建与基础资源',
      l2: '配额与数量',
    })
    expect(match('eip', '客户申请将带宽配额提升至5120M')).toEqual({
      l1: '开通与申领',
      l2: '配额与数量',
    })
  })
})
