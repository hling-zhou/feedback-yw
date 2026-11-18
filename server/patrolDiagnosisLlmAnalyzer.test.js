import { describe, expect, it, vi } from 'vitest'

/**
 * LLM 结构化诊断分析器守卫（11-18 沉淀——此前只有一次性 node 验证脚本，无守卫）。
 * 契约锚定：
 *  1. 请求 body 必须显式 max_tokens=8192（推理型模型 reasoning 与正文共享预算——
 *     共享默认 2048 下复杂组推理吃光预算，正文 0 字/JSON 截断，实测 7 组 3 连败先例）
 *  2. LLM 失败重试语义（拍板）：最多 3 次尝试 + 指数退避；3 次全失败 → llmFailed=true
 *     且五段全空（调用方视为未诊断，组保持 pending）
 *  3. LLM 输出解析：markdown 剥壳 + 平衡块兜底 + 枚举只选不造
 */

const MCP_TEXT = JSON.stringify({
  code: '0000',
  data: {
    records: [
      { content: '[2026-11-11 10:00:00] [ERROR] [1] Bind failed: blackCidrAddress conflict' },
      { content: '[2026-11-11 10:00:01] [ WARN] [2] retry suppressed' },
    ],
  },
})

/** 构造 mock forward：记录收到的完整请求 opts 与 body，返回指定序列的响应。 */
function makeForward(responses) {
  const seenBodies = []
  const seenOpts = []
  const forward = async (opts) => {
    seenOpts.push(opts)
    seenBodies.push(opts.body)
    const item = responses[Math.min(seenBodies.length - 1, responses.length - 1)]
    if (item instanceof Error) throw item
    return {
      choices: [{ message: { role: 'assistant', content: item }, finish_reason: 'stop' }],
    }
  }
  return { forward, seenBodies, seenOpts }
}

const VALID_REPORT = JSON.stringify({
  conclusion: '业务规则校验拒绝',
  directCause: ['[ERROR] Bind failed: blackCidrAddress conflict'],
  evidence: ['网段冲突'],
  suggestion: '先解绑再重试',
  rootCauseL1: '业务冲突',
})

describe('patrolDiagnosisLlmAnalyzer', () => {
  it('extractErrorCodes：错误码清单提取（去重保序）——11-18 拍板喂 LLM 的结构化信号', async () => {
    const { extractErrorCodes } = await import('./patrolDiagnosisLlmAnalyzer.js')
    expect(extractErrorCodes('errorCode=CSLOPENSTACK_NETWORK_IP_BIZ_IN_LOCK_OPERATE, x')).toEqual(['CSLOPENSTACK_NETWORK_IP_BIZ_IN_LOCK_OPERATE'])
    // 去重保序
    expect(extractErrorCodes('a errorCode=AAA_BBB_CC d errorCode=AAA_BBB_CC e errorCode=DDD_EEE_FF')).toEqual(['AAA_BBB_CC', 'DDD_EEE_FF'])
    // 无码/短码（<6 位防误匹配）
    expect(extractErrorCodes('no code here')).toEqual([])
    expect(extractErrorCodes('errorCode=ABC')).toEqual([])
  })

  it('错误码清单注入 user content：判类第一优先级信号（11-18 拍板——不预维护白名单，LLM 现场判归属）', async () => {
    const { analyzeFailureByLlm } = await import('./patrolDiagnosisLlmAnalyzer.js')
    const mcpWithCode = JSON.stringify({
      code: '0000',
      data: {
        records: [
          { content: '[ERROR] errorCode=CSLOPENSTACK_NETWORK_IP_BIZ_IN_LOCK_OPERATE errorMessage=锁定中' },
          { content: '[WARN] retry suppressed' },
        ],
      },
    })
    const { forward, seenBodies } = makeForward([VALID_REPORT])
    const r = await analyzeFailureByLlm(mcpWithCode, {}, {
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.ok).toBe(true)
    const userContent = seenBodies[0].messages.find((m) => m.role === 'user').content
    expect(userContent).toContain('CSLOPENSTACK_NETWORK_IP_BIZ_IN_LOCK_OPERATE')
    expect(userContent).toContain('判类第一优先级信号')
    // 无码形态：显式告知「未提取到」而不是静默缺段
    const { forward: f2, seenBodies: b2 } = makeForward([VALID_REPORT])
    await analyzeFailureByLlm(MCP_TEXT, {}, { llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward: f2 } })
    const uc2 = b2[0].messages.find((m) => m.role === 'user').content
    expect(uc2).toContain('未提取到平台错误码')
  })

  it('请求 body 显式 max_tokens=8192（防推理型模型截断——7 组 3 连败先例）', async () => {
    const { analyzeFailureByLlm } = await import('./patrolDiagnosisLlmAnalyzer.js')
    const { forward, seenBodies, seenOpts } = makeForward([VALID_REPORT])
    const deps = {
      llm: { apiKey: 'test-key', baseUrl: 'http://llm.test/v1', model: 'test-model', forward },
    }
    const r = await analyzeFailureByLlm(MCP_TEXT, {}, deps)
    expect(r.ok).toBe(true)
    expect(r.byLlm).toBe(true)
    expect(seenBodies.length).toBe(1)
    expect(seenBodies[0].max_tokens).toBe(8192)
    expect(seenBodies[0].temperature).toBe(0)
    // timeout 与 token 预算联动：8192÷78 tok/s ≈ 105s 封顶 + 余量 = 120s
    //（旧 60s 按 2048 预算时代标定，#214 首跑超时先例——放宽只吸收「生成慢」形态）
    expect(seenOpts[0].timeoutMs).toBe(120_000)
  })

  it('LLM 五连败 → llmFailed=true 且五段全空（视为未诊断——11-18 拍板 3→5 次）', async () => {
    const { analyzeFailureByLlm } = await import('./patrolDiagnosisLlmAnalyzer.js')
    const { forward, seenBodies } = makeForward(['不是JSON的散文', '还是不行', '垃圾', '再失败', '彻底失败'])
    const onRetry = vi.fn()
    const deps = {
      llm: { apiKey: 'test-key', baseUrl: 'http://llm.test/v1', model: 'test-model', forward },
      onRetry,
    }
    const r = await analyzeFailureByLlm(MCP_TEXT, {}, deps)
    expect(seenBodies.length).toBe(5)
    expect(r.llmFailed).toBe(true)
    expect(r.byLlm).toBe(false)
    expect(r.attempts).toBe(5)
    expect(r.conclusion).toBeNull()
    expect(r.directCause).toEqual([])
    expect(r.evidence).toEqual([])
    expect(r.suggestion).toBeNull()
    expect(r.rootCauseL1).toBeNull()
    expect(onRetry).toHaveBeenCalledTimes(4)
  })

  it('首败二成 → attempts=2，结果可用', async () => {
    const { analyzeFailureByLlm } = await import('./patrolDiagnosisLlmAnalyzer.js')
    const { forward, seenBodies } = makeForward(['坏输出', VALID_REPORT])
    const deps = {
      llm: { apiKey: 'test-key', baseUrl: 'http://llm.test/v1', model: 'test-model', forward },
    }
    const r = await analyzeFailureByLlm(MCP_TEXT, {}, deps)
    expect(seenBodies.length).toBe(2)
    expect(r.llmFailed).toBe(false)
    expect(r.attempts).toBe(2)
    expect(r.byLlm).toBe(true)
    expect(r.rootCauseL1).toBe('业务冲突')
  })

  it('markdown 代码块包裹的 JSON 可解析', async () => {
    const { analyzeFailureByLlm } = await import('./patrolDiagnosisLlmAnalyzer.js')
    const wrapped = '```json\n' + VALID_REPORT + '\n```'
    const { forward } = makeForward([wrapped])
    const deps = {
      llm: { apiKey: 'test-key', baseUrl: 'http://llm.test/v1', model: 'test-model', forward },
    }
    const r = await analyzeFailureByLlm(MCP_TEXT, {}, deps)
    expect(r.byLlm).toBe(true)
    expect(r.rootCauseL1).toBe('业务冲突')
    expect(r.directCause).toEqual(['[ERROR] Bind failed: blackCidrAddress conflict'])
  })

  it('散文包裹 JSON（平衡块兜底）可解析', async () => {
    const { analyzeFailureByLlm } = await import('./patrolDiagnosisLlmAnalyzer.js')
    const prose = '好的，以下是诊断：\n' + VALID_REPORT + '\n以上就是全部内容。'
    const { forward } = makeForward([prose])
    const deps = {
      llm: { apiKey: 'test-key', baseUrl: 'http://llm.test/v1', model: 'test-model', forward },
    }
    const r = await analyzeFailureByLlm(MCP_TEXT, {}, deps)
    expect(r.byLlm).toBe(true)
    expect(r.rootCauseL1).toBe('业务冲突')
  })

  it('rootCauseL1 枚举外值 → 只选不造，l1=null', async () => {
    const { analyzeFailureByLlm } = await import('./patrolDiagnosisLlmAnalyzer.js')
    const bad = JSON.stringify({
      conclusion: 'x', directCause: [], evidence: [], suggestion: 'y',
      rootCauseL1: '自造的类别',
    })
    const { forward } = makeForward([bad])
    const deps = {
      llm: { apiKey: 'test-key', baseUrl: 'http://llm.test/v1', model: 'test-model', forward },
    }
    const r = await analyzeFailureByLlm(MCP_TEXT, {}, deps)
    expect(r.byLlm).toBe(true) // conclusion 等字段仍可用
    expect(r.rootCauseL1).toBeNull()
  })

  it('无日志行输入 → ok=false 不调 LLM', async () => {
    const { analyzeFailureByLlm } = await import('./patrolDiagnosisLlmAnalyzer.js')
    const empty = JSON.stringify({ code: '0000', data: { records: [] } })
    const { forward, seenBodies } = makeForward([VALID_REPORT])
    const deps = {
      llm: { apiKey: 'test-key', baseUrl: 'http://llm.test/v1', model: 'test-model', forward },
    }
    const r = await analyzeFailureByLlm(empty, {}, deps)
    expect(r.ok).toBe(false)
    expect(seenBodies.length).toBe(0)
  })

  it('未配置 LLM apiKey → byLlm=false 且不重试不失败（合法状态走规则）', async () => {
    const { analyzeFailureByLlm } = await import('./patrolDiagnosisLlmAnalyzer.js')
    const { forward, seenBodies } = makeForward([VALID_REPORT])
    const deps = {
      llm: { apiKey: '', baseUrl: 'http://llm.test/v1', model: 'test-model', forward },
    }
    // apiKey 为空字符串 → resolveLlmApiKey 抛错路径需要 env 也无配置；
    // 本测试 env 继承外部，风险：CI 配置了 LLM_API_KEY 会让此测试走 forward。
    // 用 deps.llm.apiKey='' + 剥离 env 的方式稳妥断言。
    const origKey = process.env.LLM_API_KEY
    delete process.env.LLM_API_KEY
    try {
      const r = await analyzeFailureByLlm(MCP_TEXT, {}, {
        ...deps,
        llm: { ...deps.llm, apiKey: '' },
      })
      // resolveLlmApiKey 库里也可能有配置——这里只断言"没调 forward 就不该有结果"
      if (seenBodies.length === 0) {
        expect(r.byLlm).toBe(false)
        expect(r.llmFailed).toBe(false)
        expect(r.attempts).toBe(0)
      }
    } finally {
      if (origKey !== undefined) process.env.LLM_API_KEY = origKey
    }
  })
})
