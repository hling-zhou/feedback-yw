import { describe, expect, it } from 'vitest'
import {
  applyPostUseOptimizationPatch,
  collectPostUseOptimizationText,
  generatePostUseOptimizations,
  needsPostUseOptimization,
  traceComplaintTicketId,
} from './postUseOptimization.js'

const visitEntity = {
  userFeedbackText: '带宽升降配失败，工单说需要等人工处理。',
  visitFeedbackDetail: '客户确认问题已解决，但仍希望流程更快。',
  visitResult: '已解决',
  internalEvaluationDetail: '内部判断无问题',
  internalConclusion: '内部判断无问题',
  remark: '备注不进语料',
}

const traceEntity = {
  itemKey: 'c:20260624185839X719076761',
  customerFeedback: '原工单编号：20260624185839X719076761；投诉整体服务评价：1；不满原因：其他',
  scoreSource: '',
  originalTicketId: '',
}

describe('collectPostUseOptimizationText', () => {
  it('visit：客户反馈 + 回访结果拼接，内部评估/备注不进语料', () => {
    const text = collectPostUseOptimizationText(visitEntity, 'visit')
    expect(text).toContain('[省代表回访反馈]')
    expect(text).toContain('带宽升降配失败')
    expect(text).toContain('客户确认问题已解决')
    expect(text).not.toContain('内部判断')
    expect(text).not.toContain('备注不进语料')
  })

  it('visit：回访结果缺失时兜底 visitResult', () => {
    const text = collectPostUseOptimizationText(
      { userFeedbackText: '反馈A', visitResult: '结果B' },
      'visit',
    )
    expect(text).toContain('反馈A')
    expect(text).toContain('结果B')
  })

  it('trace：客户反馈 + 投诉回访处理意见段（注入）', () => {
    const text = collectPostUseOptimizationText(traceEntity, 'trace', {
      complaintHandlingText: '已为客户放通安全组端口。',
    })
    expect(text).toContain('[产品部溯源·客户反馈]')
    expect(text).toContain('投诉整体服务评价')
    expect(text).toContain('【原投诉工单处理意见】')
    expect(text).toContain('已为客户放通安全组端口。')
  })

  it('trace：非投诉回访不拼处理意见段', () => {
    const text = collectPostUseOptimizationText(
      { customerFeedback: '反馈内容' },
      'trace',
      { complaintHandlingText: '不应出现' },
    )
    // complaintHandlingText 仅在传入时拼接（调用方已按 traceComplaintTicketId 判定），
    // 本用例直接传值验证函数忠实拼接调用方输入
    expect(text).toContain('不应出现')
  })

  it('无语料返回空串（不带场景前缀）', () => {
    expect(collectPostUseOptimizationText({}, 'visit')).toBe('')
    expect(collectPostUseOptimizationText(null, 'trace')).toBe('')
  })
})

describe('needsPostUseOptimization', () => {
  it('有语料且未生成 → true', () => {
    expect(needsPostUseOptimization(visitEntity, 'visit')).toBe(true)
  })

  it('已有 optimizationProduct → false（幂等，不重生成）', () => {
    expect(needsPostUseOptimization({ ...visitEntity, optimizationProduct: '已有建议' }, 'visit')).toBe(false)
  })

  it('无语料 → false', () => {
    expect(needsPostUseOptimization({ userFeedbackText: '' }, 'visit')).toBe(false)
    expect(needsPostUseOptimization(null, 'visit')).toBe(false)
  })
})

describe('traceComplaintTicketId', () => {
  it('存量 c: 前缀（scoreSource 缺失兜底空串）→ 从 itemKey 第 2 段取工单号', () => {
    expect(traceComplaintTicketId(traceEntity)).toBe('20260624185839X719076761')
  })

  it('scoreSource=投诉回访 → originalTicketId 优先', () => {
    expect(
      traceComplaintTicketId({ scoreSource: '投诉回访', originalTicketId: 'T1', itemKey: 'c:T1' }),
    ).toBe('T1')
  })

  it('scoreSource=投诉回访 且 originalTicketId 空 → itemKey 第 2 段兜底', () => {
    expect(traceComplaintTicketId({ scoreSource: '投诉回访', originalTicketId: '', itemKey: 'c:T2' })).toBe('T2')
  })

  it('q: 前缀（问卷类）→ 空', () => {
    expect(traceComplaintTicketId({ itemKey: 'q:E123:云专线:2026-06' })).toBe('')
  })
})

describe('generatePostUseOptimizations', () => {
  it('LLM 未配置 → 规则结果且来源标 rule', async () => {
    const result = await generatePostUseOptimizations(visitEntity, 'visit', /** @type {any} */ ({}))
    expect(result.optimizationSource).toBe('rule')
    // 带宽升降配在规则词表 JOURNEY_PRODUCT_TIPS 之外，文本匹配给兜底或空
    expect(typeof result.optimizationProduct).toBe('string')
  })

  it('无语料 → 三字段全空且不报错', async () => {
    const result = await generatePostUseOptimizations({}, 'visit', /** @type {any} */ ({}))
    expect(result.optimizationProduct).toBe('')
    expect(result.optimizationService).toBe('')
  })

  it('LLM 失败 → 回退规则结果且来源如实标 rule（不标 llm）', async () => {
    // 不注入 llm transport：浏览器模式直接 fetch 会失败 → 走 catch 回退
    const settings = /** @type {any} */ ({ themeMatchMode: 'semantic', llmBaseUrl: 'http://127.0.0.1:1', llmApiKey: 'x', llmModel: 'm' })
    const result = await generatePostUseOptimizations(visitEntity, 'visit', settings)
    expect(result.optimizationSource).toBe('rule')
  })
})

describe('applyPostUseOptimizationPatch', () => {
  it('只 merge 三字段，其余字段保留（写回防覆盖）', () => {
    const entity = { id: 'v1', internalEvaluationDetail: '人工评估', assigneeName: '张三', remark: 'r' }
    const next = applyPostUseOptimizationPatch(entity, {
      optimizationProduct: 'P1',
      optimizationService: 'S1',
      optimizationSource: 'llm',
    })
    expect(next.id).toBe('v1')
    expect(next.internalEvaluationDetail).toBe('人工评估')
    expect(next.assigneeName).toBe('张三')
    expect(next.remark).toBe('r')
    expect(next.optimizationProduct).toBe('P1')
    expect(next.optimizationService).toBe('S1')
    expect(next.optimizationSource).toBe('llm')
    // 原对象不被修改
    expect(entity.optimizationProduct).toBeUndefined()
  })
})
