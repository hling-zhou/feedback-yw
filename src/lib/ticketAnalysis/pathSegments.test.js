import { describe, expect, it } from 'vitest'
import { parseRequestNodeSegments } from './pathSegments.js'

describe('parseRequestNodeSegments', () => {
  it('截断单行堆叠的模板字段（真实工单格式：节点值与「工单标题」无分隔符）', () => {
    const text =
      '请求节点：VPC--VPC业务变更工单标题：VPC业务变更详细内容：同一VPC两台主机 分别位于不同安全组联系时间：9:00 — 18:00##产品名称：虚拟私有云受理渠道：自建'
    const { raw, segments } = parseRequestNodeSegments(text)
    expect(raw).toBe('VPC--VPC业务变更')
    expect(segments).toEqual(['VPC', 'VPC业务变更'])
  })

  it('缺失「工单标题」时按「详细内容」截断', () => {
    const { segments } = parseRequestNodeSegments(
      '请求节点：云主机--云主机业务变更详细内容：云服务器带宽只跑到0.5mb',
    )
    expect(segments).toEqual(['云主机', '云主机业务变更'])
  })

  it('支持三段格式并过滤 undefined 段', () => {
    const { segments } = parseRequestNodeSegments(
      '系统路径：undefined--弹性公网IP--产品使用问题--公网IP绑定/解绑失败',
    )
    expect(segments).toEqual(['弹性公网IP', '产品使用问题', '公网IP绑定/解绑失败'])
  })

  it('三段格式的末段同样在模板字段名处截断', () => {
    const { segments } = parseRequestNodeSegments(
      '系统路径：undefined--弹性公网IP--产品使用问题--公网IP绑定/解绑失败工单标题：公网IP绑定/解绑失败',
    )
    expect(segments).toEqual(['弹性公网IP', '产品使用问题', '公网IP绑定/解绑失败'])
  })

  it('换行分隔的格式保持原有行为', () => {
    const { segments } = parseRequestNodeSegments(
      '请求节点：VPC--VPC业务变更\n工单标题：VPC业务变更\n详细内容：子网冲突',
    )
    expect(segments).toEqual(['VPC', 'VPC业务变更'])
  })

  it('无请求节点行时返回空', () => {
    expect(parseRequestNodeSegments('普通受理内容，无请求节点和工单标题')).toEqual({
      raw: '',
      segments: [],
    })
    expect(parseRequestNodeSegments('')).toEqual({ raw: '', segments: [] })
    expect(parseRequestNodeSegments(undefined)).toEqual({ raw: '', segments: [] })
  })
})
