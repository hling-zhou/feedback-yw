import { describe, expect, it } from 'vitest'
import {
  collectCustomerRequestCandidates,
  extractCustomerRequest,
  extractLifecycleCustomerPhrases,
  selectBestCustomerRequest,
  truncateCustomerRequest,
} from './customerRequestExtract.js'
import { isFormattedTemplateContent, isInternalCsBackendText } from './customerRequestFilters.js'

describe('customerRequestExtract lifecycle rules', () => {
  it('example2: prefers initial customer feedback over later coordination deferral', () => {
    const text = [
      '系统路径：undefined--云专线--故障报修--可用性/连通性',
      '详细内容：开始&客服组：客户反馈专线不通，请排查。协办&网络组：已联系客户，客户表示稍后提供拓扑。',
      '反馈&客服组：客户暂未回复，工单保留。',
    ].join('\n')

    const result = extractCustomerRequest({ rawText: text, handlingText: text })
    expect(result).toMatch(/专线不通/)
    expect(result).toMatch(/排查/)
    expect(result).not.toMatch(/客服组|拓扑|暂未回复|工单保留/)
  })

  it('example1: keeps urgent customer quote when present', () => {
    const text = [
      '详细内容：首处理&应用一组：客户反馈EIP已绑定成功，但外网访问8085端口不通。',
      '客户原话："业务急着上线，端口一直不通，麻烦尽快放开。"',
    ].join('\n')

    const result = extractCustomerRequest({
      rawText: text,
      handlingText: text,
      customerQuote: '业务急着上线，端口一直不通，麻烦尽快放开。',
    })
    expect(result).toMatch(/端口|不通|放开/)
  })

  it('uses evolved append request when more complete than initial quote', () => {
    const result = extractCustomerRequest({
      rawText:
        '【受理内容】\n公网 IP 无法访问\n\n【追加信息】\n客户补充：HTTPS 仍提示证书错误，需一并排查',
      handlingText: '已协助调整安全组',
      customerQuote: '公网 IP 无法访问',
    })
    expect(result).toMatch(/HTTPS|证书/)
  })

  it('filters internal backend workflow phrases', () => {
    expect(isInternalCsBackendText('请网络组抓包定位')).toBe(true)
    expect(isInternalCsBackendText('已返单')).toBe(true)
    expect(isInternalCsBackendText('建群处理')).toBe(true)
    expect(isInternalCsBackendText('专线不通，请排查')).toBe(false)
  })

  it('extractLifecycleCustomerPhrases collects multiple stages', () => {
    const corpus =
      '详细内容：开始&客服组：客户反馈公网不通。协办&网络组：已联系客户。反馈&客服组：客户补充：443端口仍不通'
    const phrases = extractLifecycleCustomerPhrases(corpus)
    expect(phrases.some((p) => /公网不通/.test(p))).toBe(true)
    expect(phrases.some((p) => /443/.test(p))).toBe(true)
  })

  it('selectBestCustomerRequest prefers clearer business guidance', () => {
    const best = selectBestCustomerRequest([
      { text: '稍后提供拓扑', phase: 2, order: 2 },
      { text: '专线不通，请排查', phase: 1, order: 1 },
    ])
    expect(best).toMatch(/专线不通/)
  })

  it('truncateCustomerRequest respects hard max 120', () => {
    const long = '这是一段很长的客户反馈'.repeat(10)
    expect(truncateCustomerRequest(long).length).toBeLessThanOrEqual(120)
  })

  it('collectCustomerRequestCandidates excludes platform handling text', () => {
    const candidates = collectCustomerRequestCandidates({
      rawText: '客户问题：无法访问\n处理意见：已协助客户调整安全组并复测通过',
      handlingText: '已协助客户调整安全组并复测通过',
    })
    expect(candidates.every((c) => !/已协助|复测通过/.test(c.text))).toBe(true)
    expect(candidates.some((c) => /无法访问/.test(c.text))).toBe(true)
  })

  it('isFormattedTemplateContent detects stacked template fields', () => {
    expect(
      isFormattedTemplateContent(
        '请求节点：全局流转--业务规则咨询/查询-全局流转工单标题：业务规则咨询/查询-全局流转详细内容：',
      ),
    ).toBe(true)
    expect(
      isFormattedTemplateContent('系统路径：undefined--云专线--故障报修工单标题：专线不通'),
    ).toBe(true)
    expect(isFormattedTemplateContent('客户反馈专线不通，请排查')).toBe(false)
    expect(isFormattedTemplateContent('EIP端口不通')).toBe(false)
    expect(isFormattedTemplateContent('')).toBe(false)
  })

  it('filters out formatted template content from customer request', () => {
    const result = extractCustomerRequest({
      customerQuote:
        '请求节点：全局流转--业务规则咨询/查询-全局流转工单标题：业务规则咨询/查询-全局流转详细内容：',
      rawText: '',
      handlingText: '',
    })
    expect(result).toBe('')
  })

  it('falls back to handling text when customer quote is pure template', () => {
    const result = extractCustomerRequest({
      customerQuote:
        '请求节点：全局流转--业务规则咨询/查询-全局流转工单标题：业务规则咨询/查询-全局流转详细内容：',
      rawText: '',
      handlingText: '详细内容：首处理&客服组：客户反馈公网IP无法访问，请帮忙排查。',
    })
    expect(result).toMatch(/公网.*无法访问|公网|无法访问/)
    expect(result).not.toMatch(/请求节点|工单标题|详细内容：/)
  })

  it('returns empty when only template content is available', () => {
    const result = extractCustomerRequest({
      customerQuote:
        '请求节点：全局流转--业务规则咨询/查询-全局流转工单标题：业务规则咨询/查询-全局流转详细内容：',
      rawText: '请求节点：全局流转--业务规则咨询/查询-全局流转',
      handlingText: '已协助客户处理',
    })
    expect(result).toBe('')
  })

  it('extracts customer demand from mobile-cloud workflow blocks with &处理意见 delimiter', () => {
    const handling = [
      '开始&客服组.南基客服专席组-01L0&处理意见：客户标签：请求节点：全局流转详细内容：客户反应，带宽问题，平台服务更新，下载了三个镜像，一次1G左右的量就把带宽打满了，30M的带宽不应该这么容易就被打满了，请排查原因，需要建群处理，36.*.*.128联系时间：9:00',
      '',
      '首处理&客服组.01&处理意见：1、客户需求：客户反应，带宽问题，平台服务更新，下载了三个镜像，一次1G左右的量就把带宽打满了，30M的带宽不应该这么容易就被打满了，请排查原因，需要建群处理2、产品UUID：36.*.*.128',
      '',
      '协办&网络安全一组&处理意见：1、【客户问题】:客户反应，带宽问题，平台服务更新，下载了三个镜像，一次1G左右的量就把带宽打满了，30M的带宽不应该这么容易就被打满了，请排查原因，需要建群处理2、【问题原因】:同上',
      '',
      '反馈&客服组.01&处理意见：您好!关于您反映的问题，经过XX云技术专家核实目前底层排查网络未发现异常。造成的不便我们深感抱歉!',
    ].join('\n')

    const result = extractCustomerRequest({ rawText: '', handlingText: handling, customerQuote: '' })
    expect(result).toMatch(/带宽/)
    expect(result).toMatch(/镜像|30M/)
    expect(result).not.toMatch(/您好!关于您反映/)
    expect(result).not.toMatch(/联系时间|36\.\*/)
    expect(result.length).toBeLessThanOrEqual(120)
  })
})
