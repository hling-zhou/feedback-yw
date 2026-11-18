import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// 环境隔离（红绿实测教训）：不隔离时 db.js 单例默认指向 server/data/auth.db（团队真库，
// llm_config_v1.apiKey 已配置）——⑤「LLM 未配置」用例的 resolveLlmApiKey 从真库拿到配置，
// 静默走了真 LLM。测试一律指向空临时库，杜绝 CI/本地库配置泄漏。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-pipeline-test-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir

/**
 * 诊断编排管线守卫（11-18 拍板：归类流程倒转）。
 * 契约锚定：
 *  1. 快速路径：无失败语义日志 → 诊断能力缺口，不调 LLM（不烧调用）
 *  2. 归类真源=规则表：规则对 LLM 产物文本（结论+直接原因+证据拼接）命中 → 规则 L1/L2，
 *     五段透传，rootCauseSource='llm'
 *  3. 规则未命中 → LLM 枚举兜底（l2=LLM结构化诊断，只选不造）
 *  4. LLM 全败（5 次——11-18 拍板）→ status='no_diagnosis'（调用方保持组 pending）
 *  5. 降级链路：LLM 未配置 → 规则对日志原文，结论=原文，rootCauseSource='rule'
 */

/** 有失败语义的 MCP 日志（extractDiagnosticText 产出非空——含 ERROR 行）。 */
const MCP_TEXT_WITH_ERROR = JSON.stringify({
  code: '0000',
  data: {
    records: [
      { content: '[2026-11-11 10:00:00] [ERROR] [1] Bind failed: blackCidrAddress conflict' },
      { content: '[2026-11-11 10:00:01] [ WARN] [2] retry suppressed' },
    ],
  },
})

/** 无失败语义的 MCP 日志（纯正常调用行——快速路径输入）。 */
const MCP_TEXT_NORMAL_ONLY = JSON.stringify({
  code: '0000',
  data: {
    records: [
      { content: '[2026-11-11 10:00:00] [INFO] [1] 调用方法 com.example.controller.create' },
      { content: '[2026-11-11 10:00:01] [INFO] [2] 记录 request 信息完成' },
    ],
  },
})

/** 规则表（种子形态最小集——含锁定规则与兜底）。 */
const RULES = [
  { order: 1, l1: '资源锁定/并发冲突', l2: '并发进行中', productAction: '待处理', anyOf: ['IS_LOCKING', '锁定'] },
  { order: 2, l1: '其他/未归类', l2: '兜底', productAction: '待处理', isFallback: true },
]

/** LLM 五段产物（锁定关键词在结论文本中——11-18 拍板口径：分类输入=结论，directCause 不进分类）。 */
const LLM_REPORT_LOCK = {
  conclusion: '资源正处于锁定状态，并发操作冲突',
  directCause: ['[ERROR] resource IS_LOCKING, please retry later'],
  evidence: ['资源 IS_LOCKING，稍后重试可能成功'],
  suggestion: '稍后重试',
  rootCauseL1: '资源锁定/并发冲突',
}

/** LLM 五段产物（规则不可命中——走枚举兜底）。 */
const LLM_REPORT_ENUM = {
  conclusion: '客户重复提交同一订单导致状态机冲突',
  directCause: ['[ERROR] order state transition rejected'],
  evidence: ['订单已是终态'],
  suggestion: '引导客户取消重复请求',
  rootCauseL1: '业务冲突',
}

/** mock analyzeFailureByLlm——通过 deps.llm.forward 挂钩即可（管线透传 deps.llm 给 analyzer）。 */
function makeForward(content) {
  return async () => ({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  })
}

describe('patrolDiagnosisPipeline（归类流程倒转——11-18 拍板）', () => {
  afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('① 快速路径：无失败语义日志 → 诊断能力缺口，且不调 LLM', async () => {
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    const forward = vi.fn(makeForward(JSON.stringify(LLM_REPORT_LOCK)))
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_NORMAL_ONLY, {}, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.status).toBe('success')
    expect(r.l1).toBe('诊断能力缺口')
    expect(r.productAction).toBe('—')
    expect(forward).not.toHaveBeenCalled() // 不烧 LLM 调用
    expect(r.rootCauseSource).toBeNull()
    expect(r.conclusion).toBeNull()
  })

  it('② 规则对 LLM 结论文本命中 → 规则定类，五段透传，源=llm；directCause 日志行不进分类（#288 噪声劫持先例）', async () => {
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    const forward = vi.fn(makeForward(JSON.stringify(LLM_REPORT_LOCK)))
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.status).toBe('success')
    // 规则表=归类真源：「锁定」在 LLM 结论文本中命中 → 规则 L1/L2
    expect(r.l1).toBe('资源锁定/并发冲突')
    expect(r.l2).toBe('并发进行中')
    expect(r.productAction).toBe('待处理')
    expect(r.rootCauseSource).toBe('llm')
    expect(r.conclusion).toBe('资源正处于锁定状态，并发操作冲突')
    expect(r.directCause).toEqual(['[ERROR] resource IS_LOCKING, please retry later'])
    expect(r.evidence).toEqual(['资源 IS_LOCKING，稍后重试可能成功'])
    expect(r.suggestion).toBe('稍后重试')
  })

  it('②b directCause 日志行含分类关键词但结论不含 → 不被劫持（结论=分类唯一真源）', async () => {
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    // 结论说 RAM 鉴权拒绝；directCause 日志行混入「锁定」——不得因日志行命中规则
    const report = {
      conclusion: 'RAM 子用户未被授权该操作，鉴权阶段直接拒绝',
      directCause: ['[WARN] checking resource IS_LOCKING before unbind'],
      evidence: ['Forbidden：未授权 action'],
      suggestion: '主账号 RAM 授权后重试',
      rootCauseL1: '参数无效/校验失败',
    }
    const forward = vi.fn(makeForward(JSON.stringify(report)))
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.status).toBe('success')
    expect(r.l1).toBe('参数无效/校验失败') // LLM 枚举兜底，非规则「锁定」劫持
    // 11-18 拍板：l2=结论首句核心语义（场景），不再是来源标注
    expect(r.l2).toBe('RAM 子用户未被授权该操作，鉴权阶段直接拒绝')
    expect(forward).toHaveBeenCalledTimes(1)
  })

  it('③ 规则未命中 → LLM 枚举兜底定 L1，l2=细分场景（conclusion 首句核心语义——11-18 拍板：L2 是场景不是来源标注）', async () => {
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    const forward = vi.fn(makeForward(JSON.stringify(LLM_REPORT_ENUM)))
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.status).toBe('success')
    expect(r.l1).toBe('业务冲突') // 来自 analysis.rootCauseL1（同一次调用产物，不二次调用）
    // l2 从结论提取细分场景短语，不再是来源标注「LLM结构化诊断」
    expect(r.l2).not.toBe('LLM结构化诊断')
    expect(r.l2).toBeTruthy()
    expect(String(r.l2).length).toBeLessThanOrEqual(24)
    expect(r.rootCauseSource).toBe('llm')
  })

  it('④ LLM 全败（5 次——11-18 拍板 3→5）→ status=no_diagnosis（调用方保持组 pending）', async () => {
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    const forward = vi.fn(async () => ({ choices: [{ message: { role: 'assistant', content: '不是JSON' } }] }))
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.status).toBe('no_diagnosis')
    expect(r.llmFailed).toBe(true)
    expect(r.llmAttempts).toBe(5)
    expect(forward).toHaveBeenCalledTimes(5)
  })

  it('⑤ LLM 未配置 → 降级旧链路：规则对日志原文，结论=原文，源=rule', async () => {
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, { rules: RULES })
    expect(r.status).toBe('success')
    expect(r.rootCauseSource).toBe('rule')
    expect(r.conclusion).toBeTruthy() // extractDiagnosticText 产出的日志原文
    expect(r.conclusion).toContain('blackCidrAddress')
    expect(r.directCause).toEqual([])
    expect(r.evidence).toEqual([])
    expect(r.suggestion).toBeNull() // 调用方走建议生成器兜底
  })
})
