import { describe, expect, it, vi, beforeEach } from 'vitest'
import { analyzeTicket, analyzeTicketAsync } from './ticketAnalysis.js'
import { truncateCustomerRequest } from './customerRequestExtract.js'

vi.mock('./customerRequestLLM.js', () => ({
  extractCustomerRequestWithLLM: vi.fn(),
}))

vi.mock('./painPointLLM.js', () => ({
  extractPainPointWithLLM: vi.fn(),
}))

vi.mock('./ticketOptimizationLLM.js', () => ({
  extractTicketOptimizationsWithLLM: vi.fn(),
}))

import { extractCustomerRequestWithLLM } from './customerRequestLLM.js'
import { extractPainPointWithLLM } from './painPointLLM.js'
import { extractTicketOptimizationsWithLLM } from './ticketOptimizationLLM.js'

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

const LLM_SETTINGS = { llmServerConfigured: true, ticketLlmMode: 'separate' }

describe('analyzeTicket (P0 rules)', () => {
  it('example1: port blocked with urgent customer quote', () => {
    const result = analyzeTicket({
      rawText: EXAMPLE1_TEXT,
      handlingText: EXAMPLE1_TEXT,
      customerQuote: '业务急着上线，端口一直不通，麻烦尽快放开。',
      product: '弹性公网IP',
      productKey: 'eip',
    })

    expect(result.customerRequest.length).toBeLessThanOrEqual(120)
    expect(result.customerRequest).toMatch(/端口|不通/)
    expect(result.painPoint.length).toBeLessThanOrEqual(80)
    expect(result.customerRequestSource).toBe('rule')
    expect(result.painPointSource).toBe('rule')
    expect(result.optimizationSource).toBe('rule')
    expect(result.urgencyLevel).toBe('high')
    expect(result.optimizationProduct).toMatch(/安全组|端口|检测/)
  })

  it('example2: fuzzy content uses path fallback', () => {
    const result = analyzeTicket({
      rawText: EXAMPLE2_TEXT,
      handlingText: EXAMPLE2_TEXT,
      product: '云专线',
      productKey: 'dc',
    })

    expect(result.requestScene).toBe('报障与排错')
    expect(result.problemType).toBe('可用性/连通性故障')
    expect(result.journeyL1).toBe('无法识别')
    expect(result.customerRequest).toMatch(/专线不通/)
    expect(result.customerRequest).not.toMatch(/客服组/)
    expect(result.optimizationService).toMatch(/催办|空转/)
    expect(result.urgencyLevel).toBe('none')
  })

  it('truncateCustomerRequest respects hard max 120', () => {
    const long = '这是一段很长的客户反馈'.repeat(10)
    expect(truncateCustomerRequest(long).length).toBeLessThanOrEqual(120)
  })

  it('problem type uses extracted customerRequest/painPoint before handling noise', () => {
    const text = [
      '详细内容：首处理&应用组：已指导客户完成EIP绑定操作，绑定流程正常。',
      '协办&计费组：核对账单扣费无误，建议客户查看账单明细。',
      '客户原话：无法退订共享带宽，请帮忙处理。',
    ].join('\n')

    const result = analyzeTicket({
      rawText: text,
      handlingText: text,
      customerQuote: '无法退订共享带宽，请帮忙处理。',
      product: '弹性公网IP',
      productKey: 'eip',
    })

    expect(result.customerRequest).toMatch(/退订/)
    expect(result.problemType).toBe('退订与释放')
  })
})

describe('analyzeTicketAsync (P1 LLM)', () => {
  beforeEach(() => {
    vi.mocked(extractCustomerRequestWithLLM).mockReset()
    vi.mocked(extractPainPointWithLLM).mockReset()
    vi.mocked(extractTicketOptimizationsWithLLM).mockReset()
  })

  it('example1: uses LLM customer request and pain point when available', async () => {
    vi.mocked(extractCustomerRequestWithLLM).mockResolvedValue(
      '外网访问8085端口不通，业务急着上线，请尽快放开。',
    )
    vi.mocked(extractPainPointWithLLM).mockResolvedValue(
      '安全组未放行特定端口导致业务访问中断。',
    )
    vi.mocked(extractTicketOptimizationsWithLLM).mockResolvedValue({
      optimizationProduct:
        '在EIP绑定成功页增加「高频业务端口连通性一键检测」，自动识别安全组/ACL拦截并提示一键放行。',
      optimizationService: '',
      optimizationSuggestion:
        '在EIP绑定成功页增加「高频业务端口连通性一键检测」，自动识别安全组/ACL拦截并提示一键放行。',
    })

    const result = await analyzeTicketAsync(
      {
        rawText: EXAMPLE1_TEXT,
        handlingText: EXAMPLE1_TEXT,
        customerQuote: '业务急着上线，端口一直不通，麻烦尽快放开。',
        product: '弹性公网IP',
        productKey: 'eip',
      },
      LLM_SETTINGS,
    )

    expect(extractCustomerRequestWithLLM).toHaveBeenCalled()
    expect(extractPainPointWithLLM).toHaveBeenCalled()
    expect(extractTicketOptimizationsWithLLM).toHaveBeenCalled()
    expect(result.customerRequest).toBe('外网访问8085端口不通，业务急着上线，请尽快放开。')
    expect(result.customerRequestSource).toBe('llm')
    expect(result.painPoint).toBe('安全组未放行特定端口导致业务访问中断。')
    expect(result.painPointSource).toBe('llm')
    expect(result.optimizationSource).toBe('llm')
    expect(result.urgencyLevel).toBe('high')
  })

  it('example2: LLM returns fuzzy-case pain point and service optimization', async () => {
    vi.mocked(extractCustomerRequestWithLLM).mockResolvedValue('专线不通，请排查。')
    vi.mocked(extractPainPointWithLLM).mockResolvedValue('专线链路中断导致业务无法互通。')
    vi.mocked(extractTicketOptimizationsWithLLM).mockResolvedValue({
      optimizationProduct:
        '在专线控制台增加「链路状态自检与拓扑上传」引导页，降低客户报障时的信息缺失率。',
      optimizationService:
        '建立「信息不全工单」自动催办机制，超4小时未补充拓扑自动触发短信提醒，避免工单空转。',
      optimizationSuggestion:
        '在专线控制台增加「链路状态自检与拓扑上传」引导页，降低客户报障时的信息缺失率。\n建立「信息不全工单」自动催办机制，超4小时未补充拓扑自动触发短信提醒，避免工单空转。',
    })

    const result = await analyzeTicketAsync(
      {
        rawText: EXAMPLE2_TEXT,
        handlingText: EXAMPLE2_TEXT,
        product: '云专线',
        productKey: 'dc',
      },
      LLM_SETTINGS,
    )

    expect(result.customerRequestSource).toBe('llm')
    expect(result.painPoint).toBe('专线链路中断导致业务无法互通。')
    expect(result.requestScene).toBe('报障与排错')
    expect(result.optimizationProduct).toMatch(/专线控制台|拓扑/)
    expect(result.optimizationService).toMatch(/催办|空转/)
  })

  it('falls back to rule output when LLM unavailable', async () => {
    const ruleOnly = analyzeTicket({
      rawText: EXAMPLE1_TEXT,
      handlingText: EXAMPLE1_TEXT,
      customerQuote: '业务急着上线，端口一直不通，麻烦尽快放开。',
      product: '弹性公网IP',
      productKey: 'eip',
    })

    const result = await analyzeTicketAsync(
      {
        rawText: EXAMPLE1_TEXT,
        handlingText: EXAMPLE1_TEXT,
        customerQuote: '业务急着上线，端口一直不通，麻烦尽快放开。',
        product: '弹性公网IP',
        productKey: 'eip',
      },
      {},
    )

    expect(extractCustomerRequestWithLLM).not.toHaveBeenCalled()
    expect(extractPainPointWithLLM).not.toHaveBeenCalled()
    expect(extractTicketOptimizationsWithLLM).not.toHaveBeenCalled()
    expect(result.painPoint).toBe(ruleOnly.painPoint)
    expect(result.customerRequest).toBe(ruleOnly.customerRequest)
    expect(result.optimizationProduct).toBe(ruleOnly.optimizationProduct)
  })

  it('falls back to rule output when LLM throws', async () => {
    vi.mocked(extractCustomerRequestWithLLM).mockRejectedValue(new Error('network'))
    vi.mocked(extractPainPointWithLLM).mockRejectedValue(new Error('network'))
    vi.mocked(extractTicketOptimizationsWithLLM).mockRejectedValue(new Error('network'))

    const ruleOnly = analyzeTicket({
      rawText: EXAMPLE1_TEXT,
      handlingText: EXAMPLE1_TEXT,
      customerQuote: '业务急着上线，端口一直不通，麻烦尽快放开。',
      product: '弹性公网IP',
      productKey: 'eip',
    })

    const result = await analyzeTicketAsync(
      {
        rawText: EXAMPLE1_TEXT,
        handlingText: EXAMPLE1_TEXT,
        customerQuote: '业务急着上线，端口一直不通，麻烦尽快放开。',
        product: '弹性公网IP',
        productKey: 'eip',
      },
      LLM_SETTINGS,
    )

    expect(result.painPoint).toBe(ruleOnly.painPoint)
    expect(result.customerRequest).toBe(ruleOnly.customerRequest)
    expect(result.optimizationProduct).toBe(ruleOnly.optimizationProduct)
  })
})
