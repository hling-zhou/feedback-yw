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
  { order: 1, l1: '资源锁定&并发冲突', l2: '并发进行中', productAction: '待处理', anyOf: ['IS_LOCKING', '锁定'] },
  { order: 2, l1: '其他&未归类', l2: '兜底', productAction: '待处理', isFallback: true },
]

/** LLM 五段产物（锁定关键词在结论文本中——11-18 拍板口径：分类输入=结论，directCause 不进分类）。 */
const LLM_REPORT_LOCK = {
  conclusion: '资源正处于锁定状态，并发操作冲突',
  directCause: ['[ERROR] resource IS_LOCKING, please retry later'],
  evidence: ['资源 IS_LOCKING，稍后重试可能成功'],
  suggestion: '稍后重试',
  rootCauseL1: '资源锁定&并发冲突',
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
    expect(r.l1).toBe('资源锁定&并发冲突')
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
      rootCauseL1: '参数无效&校验失败',
    }
    const forward = vi.fn(makeForward(JSON.stringify(report)))
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.status).toBe('success')
    expect(r.l1).toBe('参数无效&校验失败') // LLM 枚举兜底，非规则「锁定」劫持
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

  it('③b（11-18 晚拍板）LLM 生成 L2 优先 + needsProductAction 现场判定：客户侧使用问题 → —；缺失默认待处理', async () => {
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    // LLM 生成 L2 + 判定不需产品侧处理（客户传参错误）
    const report = {
      conclusion: '客户传入的参数不满足校验规则，请求被拒绝',
      directCause: ['[ERROR] invalid param'], evidence: ['参数校验失败'], suggestion: '修正参数后重试',
      rootCauseL1: '参数无效&校验失败', rootCauseL2: '参数校验拒绝',
      needsProductAction: false, actionReason: '客户侧传参错误，产品无缺陷',
    }
    const forward = vi.fn(makeForward(JSON.stringify(report)))
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.l1).toBe('参数无效&校验失败')
    expect(r.l2).toBe('参数校验拒绝') // LLM 生成值优先（不再走结论首句提取）
    expect(r.productAction).toBe('—') // needsProductAction=false → 不需产品侧处理
    expect(r.actionReason).toBe('客户侧传参错误，产品无缺陷')
    // 旧形态兼容：无 needsProductAction 字段 → 保守默认待处理（fixture=LLM_REPORT_ENUM 无该字段）
    const forward2 = vi.fn(makeForward(JSON.stringify(LLM_REPORT_ENUM)))
    const r2 = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward: forward2 },
    })
    expect(r2.productAction).toBe('待处理')
    // needsProductAction=true（平台故障）→ 待处理
    const report3 = { ...report, needsProductAction: true, actionReason: '状态机异常需修复' }
    const forward3 = vi.fn(makeForward(JSON.stringify(report3)))
    const r3 = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward: forward3 },
    })
    expect(r3.productAction).toBe('待处理')
  })

  // ---------- 11-24 拍板：productAction 双路径统一（规则命中分支 LLM 判定优先——A1） ----------
  it('②c（11-24 A1）规则命中 + LLM needsProductAction=false → — 优先于规则表硬编码（改前红：#378 型矛盾）', async () => {
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    // 业务冲突规则（计费/订单策略限制——#378 先例同形态）+ LLM 判不需产品侧处理（#377 同语义）
    const rules = [
      { order: 20, l1: '业务冲突', l2: '计费/订单策略限制', productAction: '待处理', anyOf: ['不支持续订'] },
      { order: 99, l1: '其他&未归类', l2: '兜底', productAction: '待处理', isFallback: true },
    ]
    const report = {
      conclusion: '该资源属于按量计费订单，产品规则本身不支持续订，请求被拦截，非平台故障',
      directCause: ['[ERROR] FOREVER_DENY'], evidence: ['订单规则限制'], suggestion: '按需选择支持续订的资源',
      rootCauseL1: '业务冲突', rootCauseL2: '计费/订单策略限制',
      needsProductAction: false, actionReason: '产品规则明确拒绝且提示清晰，属规则限制非平台故障',
    }
    const forward = vi.fn(makeForward(JSON.stringify(report)))
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.l1).toBe('业务冲突')            // 规则仍定类（归类真源不变）
    expect(r.l2).toBe('计费/订单策略限制')
    expect(r.productAction).toBe('—')        // 改前红：旧逻辑用规则表硬编码「待处理」——#378 矛盾本体
    expect(r.actionReason).toContain('规则表倾向 待处理，LLM 现场判 —')  // 不一致如实标注
    expect(r.actionReason).toContain('属规则限制非平台故障')
  })

  it('②d（11-24 A1）规则命中 + LLM needsProductAction=true → 待处理且不标不一致；LLM 无该字段 → 规则值兜底（降级链路行为不变）', async () => {
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    const rules = [
      { order: 1, l1: '资源锁定&并发冲突', l2: '并发进行中', productAction: '—', anyOf: ['IS_LOCKING', '锁定'] },
      { order: 99, l1: '其他&未归类', l2: '兜底', productAction: '待处理', isFallback: true },
    ]
    // LLM 判需处理 → 与规则「—」不一致 → 待处理 + 标注
    const r1 = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward: vi.fn(makeForward(JSON.stringify({ ...LLM_REPORT_LOCK, needsProductAction: true, actionReason: '锁定长时间不释放需排查' }))) },
    })
    expect(r1.l1).toBe('资源锁定&并发冲突')
    expect(r1.productAction).toBe('待处理')   // LLM true 优先（规则值 — 被覆盖）
    expect(r1.actionReason).toContain('规则表倾向 —，LLM 现场判 待处理')
    // LLM 无 needsProductAction 字段（旧形态 fixture）→ analyzer 保守归一 true → 待处理
    // （保守默认语义与枚举分支一致——analyzer.js:230「判断不了取 true」；规则值「—」被覆盖并标注）
    const r2 = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, {}, {
      rules,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward: vi.fn(makeForward(JSON.stringify(LLM_REPORT_LOCK))) },
    })
    expect(r2.productAction).toBe('待处理')   // analyzer 归一 true → LLM 判定优先
    expect(r2.actionReason).toContain('规则表倾向 —，LLM 现场判 待处理')
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

  // ---------- 11-21 10:38 拍板：豁免白名单精确匹配（替代 11-20 全量仿真豁免——面太大误伤） ----------
  it('⑥ 豁免红绿：白名单命中组合（cmic_sim×L7POLICY/CREATE）判出待处理 → 强制 — 且 actionReason 标注', async () => {
    const { putPatrolActionExemptions, clearPatrolActionExemptionsCache } = await import('./patrolActionExemptions.js')
    clearPatrolActionExemptionsCache()
    putPatrolActionExemptions([{ id: 't1', userName: 'cmic_sim', apiPath: 'L7POLICY/CREATE', note: '', enabled: true, createdAt: 't' }], { username: 'test' })
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    const forward = vi.fn(makeForward(JSON.stringify(LLM_REPORT_LOCK)))
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, { userName: 'cmic_sim', apiPath: 'L7POLICY/CREATE' }, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.status).toBe('success')
    expect(r.l1).toBe('资源锁定&并发冲突')     // 分类不受豁免影响
    expect(r.productAction).toBe('—')          // 白名单命中豁免（改前红：全量仿真豁免时代断言口径不同）
    expect(r.actionReason).toContain('命中处理豁免白名单')
  })

  it('⑥b 豁免边界：同客户不同接口 / 同接口不同客户 / 停用规则 / 真实客户——均不豁免（11-21 精确匹配红绿）', async () => {
    const { putPatrolActionExemptions, clearPatrolActionExemptionsCache } = await import('./patrolActionExemptions.js')
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    const mk = async (userName, apiPath) => {
      const forward = vi.fn(makeForward(JSON.stringify(LLM_REPORT_LOCK)))
      return runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, { userName, apiPath }, {
        rules: RULES,
        llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
      })
    }
    // 白名单只有 cmic_sim×L7POLICY/CREATE；cmic_sim 其他接口不豁免（11-21 用户拍板核心边界）
    clearPatrolActionExemptionsCache()
    putPatrolActionExemptions([{ id: 't1', userName: 'cmic_sim', apiPath: 'L7POLICY/CREATE', note: '', enabled: true, createdAt: 't' }], { username: 'test' })
    const r1 = await mk('cmic_sim', 'MEMBER/CREATE')
    expect(r1.productAction).toBe('待处理')     // 同客户不同接口——不豁免（改前红：全量仿真豁免会豁免）
    const r2 = await mk('cmic_chinamobile', 'L7POLICY/CREATE')
    expect(r2.productAction).toBe('待处理')     // 同接口不同客户——不豁免
    const r3 = await mk('zhangsan_gongsi', '/acl/v3/floatingip/bind')
    expect(r3.productAction).toBe('待处理')     // 真实客户——不豁免
    expect(String(r3.actionReason || '')).not.toContain('豁免白名单')
    // 停用规则不豁免
    clearPatrolActionExemptionsCache()
    putPatrolActionExemptions([{ id: 't1', userName: 'cmic_sim', apiPath: 'L7POLICY/CREATE', note: '', enabled: false, createdAt: 't' }], { username: 'test' })
    const r4 = await mk('cmic_sim', 'L7POLICY/CREATE')
    expect(r4.productAction).toBe('待处理')     // enabled=false——不豁免
    // 11-21 11:14 拍板：接口名称空=匹配该客户任意接口（字段级通配）
    clearPatrolActionExemptionsCache()
    putPatrolActionExemptions([{ id: 't2', userName: 'cmic_sim', apiPath: '', note: '', enabled: true, createdAt: 't' }], { username: 'test' })
    const r5 = await mk('cmic_sim', 'MEMBER/CREATE')
    expect(r5.productAction).toBe('—')          // 空接口规则——任意接口豁免（改前红：全等时代不豁免）
    // 资源池限定的规则：非匹配池不豁免
    clearPatrolActionExemptionsCache()
    putPatrolActionExemptions([{ id: 't3', userName: 'cmic_sim', apiPath: 'L7POLICY/CREATE', poolName: '华北-北京3', note: '', enabled: true, createdAt: 't' }], { username: 'test' })
    const r6 = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, { userName: 'cmic_sim', apiPath: 'L7POLICY/CREATE', poolName: '华南-广州3' }, {
      rules: RULES, llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward: vi.fn(makeForward(JSON.stringify(LLM_REPORT_LOCK))) },
    })
    expect(r6.productAction).toBe('待处理')     // 池不匹配——不豁免
    clearPatrolActionExemptionsCache()
  })

  it('⑥c 豁免边界：11-20 全量仿真语义退役——含 test 的真实客户不因账号名被豁免', async () => {
    const { putPatrolActionExemptions, clearPatrolActionExemptionsCache } = await import('./patrolActionExemptions.js')
    clearPatrolActionExemptionsCache()
    putPatrolActionExemptions([{ id: 't1', userName: 'cmic_sim', apiPath: 'L7POLICY/CREATE', note: '', enabled: true, createdAt: 't' }], { username: 'test' })
    const { runPatrolDiagnosisPipeline } = await import('./patrolDiagnosisPipeline.js')
    const forward = vi.fn(makeForward(JSON.stringify(LLM_REPORT_LOCK)))
    // 账号名含 test 但不在白名单——不豁免（11-20 全量语义下会误豁免，11-21 收敛后不受影响）
    const r = await runPatrolDiagnosisPipeline(MCP_TEXT_WITH_ERROR, { userName: 'user_test_01', apiPath: 'L7POLICY/CREATE' }, {
      rules: RULES,
      llm: { apiKey: 'k', baseUrl: 'http://t/v1', model: 'm', forward },
    })
    expect(r.productAction).toBe('待处理')
    expect(String(r.actionReason || '')).not.toContain('豁免')
    clearPatrolActionExemptionsCache()
  })
})
