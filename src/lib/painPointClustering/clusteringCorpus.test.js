import { describe, expect, it } from 'vitest'
import {
  extractDemandClause,
  extractClusterPainTheme,
  getClusteringPainText,
  getInsightPainText,
  isUsableClusteringPainText,
  isBackgroundContextText,
  looksLikeBackgroundInsightSummary,
  looksLikeTicketMetadataSummary,
  normalizeClusteringPainText,
  pickInsightRepresentativePain,
} from './clusteringCorpus.js'

describe('clusteringCorpus', () => {
  it('isUsableClusteringPainText rejects placeholders', () => {
    expect(isUsableClusteringPainText('无')).toBe(false)
    expect(isUsableClusteringPainText('暂无')).toBe(false)
    expect(isUsableClusteringPainText('abc')).toBe(false)
    expect(isUsableClusteringPainText('公网端口无法访问')).toBe(true)
  })

  it('normalizeClusteringPainText strips ticket template metadata', () => {
    const raw =
      '请求节点：计费咨询--计费咨询工单标题：计费咨询详细内容：关于广州资源池需要将共享带宽的弹性公网IP数量提升至40。'
    expect(normalizeClusteringPainText(raw)).toMatch(/广州资源池/)
    expect(normalizeClusteringPainText(raw)).not.toMatch(/请求节点|工单标题/)
  })

  it('normalizeClusteringPainText handles 全局流转 template with masked instance id', () => {
    const raw =
      '请求节点：全局流转--业务规则咨询/查询-全局流转工单标题：业务规则咨询/查询-全局流转详细内容：本司一共12台云主机实例ID为【618d0314-****-*----'
    const cleaned = normalizeClusteringPainText(raw)
    expect(cleaned).toMatch(/本司一共12台云主机/)
    expect(cleaned).not.toMatch(/请求节点|工单标题|详细内容：/)
  })

  it('looksLikeTicketMetadataSummary detects uncleaned insight text', () => {
    const raw =
      '请求节点：全局流转--业务规则咨询/查询-全局流转工单标题：业务规则咨询/查询-全局流转详细内容：本司一共12台云主机'
    expect(looksLikeTicketMetadataSummary(raw)).toBe(true)
    expect(looksLikeTicketMetadataSummary('本司一共12台云主机实例配额不足')).toBe(false)
  })

  it('rejects background context and picks demand clause for insight pain', () => {
    const background =
      '由于我单位近期承接了大量短视频AI智能剪辑、以及高画质游戏画面的渲染处理业----'
    expect(isBackgroundContextText(background)).toBe(true)
    expect(getInsightPainText({ painPoint: background })).toBe('')

    const mixed =
      '由于我单位近期承接了大量短视频AI智能剪辑、以及高画质游戏画面的渲染处理业务，现需升级云主机配置与带宽以保障渲染性能。'
    expect(getInsightPainText({ painPoint: mixed })).toMatch(/升级云主机配置|渲染性能/)
    expect(extractDemandClause(mixed)).toMatch(/升级云主机配置|渲染性能/)
    expect(extractDemandClause(mixed)).not.toMatch(/^由于我单位/)
  })

  it('pickInsightRepresentativePain prefers mined painPoint over customerRequest background', () => {
    const background =
      '由于我单位近期承接了大量短视频AI智能剪辑、以及高画质游戏画面的渲染处理业----'
    const records = [
      {
        painPoint: background,
        customerRequest: background,
      },
      {
        painPoint: '云主机内存不足导致渲染任务频繁 OOM。',
        customerRequest: background,
      },
      {
        painPoint: '云主机内存不足导致渲染任务频繁 OOM。',
        customerRequest: background,
      },
    ]
    expect(pickInsightRepresentativePain(records)).toBe('云主机内存不足导致渲染任务频繁 OOM。')
  })

  it('looksLikeBackgroundInsightSummary flags truncated background summaries', () => {
    const summary =
      '由于我单位近期承接了大量短视频AI智能剪辑、以及高画质游戏画面的渲染处理业----（3 条工单）'
    expect(looksLikeBackgroundInsightSummary(summary)).toBe(true)
  })

  it('extractClusterPainTheme returns concise theme without field labels', () => {
    const theme = extractClusterPainTheme(
      '关于广州资源池需要将三个共享带宽的弹性公网IP数量提升至40。',
    )
    expect(theme).toMatch(/广州资源池|共享带宽|弹性公网/)
    expect(theme).not.toMatch(/请求节点/)
  })

  it('getClusteringPainText falls back to customerRequest then problemSummary', () => {
    expect(
      getClusteringPainText({
        painPoint: '',
        customerRequest: '申请提升带宽配额上限',
      }),
    ).toBe('申请提升带宽配额上限')

    expect(
      getClusteringPainText({
        painPoint: '无',
        customerRequest: '',
        problemSummary: '专线链路中断影响业务',
      }),
    ).toBe('专线链路中断影响业务')

    expect(
      getClusteringPainText({
        painPoint: '安全组未放行导致端口不通',
        customerRequest: '其他内容',
      }),
    ).toBe('安全组未放行导致端口不通')
  })
})
