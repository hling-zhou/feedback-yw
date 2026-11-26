import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'

/**
 * 根因分类器黄金对拍测试（M4 · 全项目质量闸门）。
 * 全量 4097 条样例失败行回放，逐 L2 计数必须与设计文档 §6.3 黄金表 ±0。
 * 数据真源：data/API 巡检/原始数据样例（外部真实推送形态）。
 * 解析失败 5 条说明：diagnoseResult 非 JSON 文本 → 截前 800 字路径，归类含在黄金数内（M6 注释）。
 */
import { classifyPatrolRootCause, extractDiagnosticText } from './patrolRootCauseClassifier.js'
import { API_PATROL_ROOT_CAUSE_RULES_SEED } from './patrolSeeds.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE_DIR = path.join(__dirname, '..', 'data', 'API 巡检', '原始数据样例')

/** 样例全量失败行（final_conclusion 提取后）→ L1/L2 分类 */
function loadSampleFailures() {
  /** @type {Array<{text: string, error: string, isElb: boolean}>} */
  const rows = []
  const eipFiles = fs.readdirSync(path.join(SAMPLE_DIR, '明细', '弹性公网IP_虚拟私有云'))
  for (const f of eipFiles) {
    const content = fs.readFileSync(path.join(SAMPLE_DIR, '明细', '弹性公网IP_虚拟私有云', f), 'utf8')
    for (const row of Papa.parse(content, { header: true, skipEmptyLines: true }).data) {
      if (String(row.result || '').trim() === '0') {
        rows.push({ text: String(row.diagnoseResult || ''), error: '', isElb: false })
      }
    }
  }
  const elbFiles = fs.readdirSync(path.join(SAMPLE_DIR, '明细', '弹性负载均衡'))
  for (const f of elbFiles) {
    const content = fs.readFileSync(path.join(SAMPLE_DIR, '明细', '弹性负载均衡', f), 'utf8')
    for (const row of Papa.parse(content, { header: true, skipEmptyLines: true }).data) {
      if (String(row.resultStatus || '').trim() === 'FAILED') {
        rows.push({ text: String(row.diagnoseResult || ''), error: String(row.errorMessage || ''), isElb: true })
      }
    }
  }
  return rows
}

describe('rootCauseClassifier 黄金对拍（设计 §6.3 ±0）', () => {
  const rules = API_PATROL_ROOT_CAUSE_RULES_SEED
  const failures = loadSampleFailures()

  it('样例失败总数 = 4097（数据源完整性自检）', () => {
    expect(failures.length).toBe(4097)
  })

  it('9.1 全量回放：逐 L2 计数对拍黄金表 ±0；待处理合计 204', () => {
    /** @type {Record<string, number>} */
    const counts = {}
    let pending = 0
    for (const f of failures) {
      const text = extractDiagnosticText(f.text, f.error, f.isElb)
      const result = classifyPatrolRootCause(text, rules)
      const key = `${result.l1}/${result.l2}`
      counts[key] = (counts[key] || 0) + 1
      if (result.productAction === '待处理') pending += 1
    }
    // 黄金表（设计 §6.3，2026-11-07 回放定稿；2026-11-18 修订：+order 0 权限/授权类——
    // 2 条双因样本（Unauthorized+配额，鉴权为直接触发因）从「配额不足/通用配额」转入权限类，配额 16→14、待处理 204→206；
    // 2026-11-26 修订：L1 拆类——规则 3/13 挪「产品可观测性不足」（日志在但读不出=产品的锅，缺省待处理），
    // 缺口两类 11+5 迁出、待处理 206→222）
    expect(counts['诊断能力缺口/日志缺失/无数据']).toBe(1968)
    expect(counts['参数无效&校验失败/域名与比较类型成对']).toBe(1786)
    expect(counts['资源锁定&并发冲突/锁定机制待查']).toBe(113)
    expect(counts['资源锁定&并发冲突/并发进行中']).toBe(96)
    expect(counts['业务冲突/绑定关系未解除']).toBe(38)
    expect(counts['资源状态异常/负载均衡器本体']).toBe(18)
    expect(counts['其他&未归类/兜底']).toBe(16)
    expect(counts['配额不足/通用配额']).toBe(14)
    expect(counts['业务冲突/HAVIP绑定业务校验']).toBe(12)
    expect(counts['产品可观测性不足/日志无ERROR/WARN']).toBe(11)   // 11-26 从缺口迁入
    expect(counts['参数无效&校验失败/IP/资源ID/地址类']).toBe(6)
    expect(counts['配额不足/HAVIP数量上限']).toBe(5)
    expect(counts['产品可观测性不足/仅WARN结论不明']).toBe(5)     // 11-26 从缺口迁入
    expect(counts['资源状态异常/后端服务器组']).toBe(2)
    expect(counts['业务冲突/资源被他人占用']).toBe(4)
    expect(counts['业务冲突/DNAT规则冲突']).toBe(1)
    expect(counts['权限&授权不足/RAM/子账号鉴权拒绝']).toBe(2)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(4097)
    expect(pending).toBe(222)
  })

  it('9.2a 输入构造：ELB "null" 字符串 + errorMessage 域名成对 → 命中规则10', () => {
    const text = extractDiagnosticText('{"final_conclusion":"null"}',
      '七层转发策略PolicyDomainName与hostNameCompareType要么都为空，要么都不为空', true)
    expect(text).toContain('要么都为空')
    const r = classifyPatrolRootCause(text, rules)
    expect(r.l2).toBe('域名与比较类型成对')
  })

  it('9.2b 输入构造："null" 且无 errorMessage → 无诊断结论（L1 诊断缺口）', () => {
    const text = extractDiagnosticText('{"final_conclusion":"null"}', '', true)
    expect(text).toBe('')
    const r = classifyPatrolRootCause(text, rules)
    expect(r.l2).toBe('无诊断结论')
  })

  it('9.2c 输入构造：非 JSON 文本 → 截前 800 字参与分类', () => {
    const long = '含DNAT的超长非JSON文本' + 'x'.repeat(900)
    const text = extractDiagnosticText(long, '', false)
    expect(text.length).toBeLessThanOrEqual(800)
    expect(text).toContain('DNAT')
  })

  it('9.2d conclusion 兜底：final_conclusion 缺失时取 conclusion（合成数据，非样例）', () => {
    const text = extractDiagnosticText('{"conclusion":"存在绑定关系需先解绑"}', '', false)
    const r = classifyPatrolRootCause(text, rules)
    expect(r.l2).toBe('绑定关系未解除')
  })

  it('9.3 有序性：DNAT 文本含锁定词 → 先命中 DNAT（不归锁定）', () => {
    const r = classifyPatrolRootCause('网卡已绑定DNAT规则，且资源处于锁定状态', rules)
    expect(r.l2).toBe('DNAT规则冲突')
  })

  it('9.4 规则可配：停用规则1后 DNAT 文本落兜底', () => {
    const disabled = rules.map((r) => (r.order === 1 ? { ...r, enabled: false } : r))
    const r = classifyPatrolRootCause('已绑定DNAT规则禁止再绑定', disabled)
    expect(r.l1).toBe('其他&未归类')
  })

  it('产品侧映射挂 L2 行：规则6并发进行中=—、规则7机制待查=待处理', () => {
    const r6 = classifyPatrolRootCause('资源正在执行其他操作，处于锁定状态，并发请求被拒', rules)
    expect(r6.productAction).toBe('—')
    const r7 = classifyPatrolRootCause('目标资源被锁定处于不可操作状态', rules)
    expect(r7.productAction).toBe('待处理')
  })

  // ================== 11-17 规则表补强（真实 MCP 日志措辞，64 兜底组分析产物）

  it('11-17 资源忙/操作进行中（A桶 19 组措辞）→ 资源锁定&并发冲突', () => {
    // 「正在执行其他操作」但无「锁定」字样——规则 6/7 原关键词不覆盖
    const r1 = classifyPatrolRootCause('虚拟网卡正在执行其他操作，请稍后重试；code=CSLOPENSTACK_NETWORK_VPORT', rules)
    expect(r1.l1).toBe('资源锁定&并发冲突')
    const r2 = classifyPatrolRootCause('公网IP正在执行其他操作，请稍后重试', rules)
    expect(r2.l1).toBe('资源锁定&并发冲突')
    const r3 = classifyPatrolRootCause('网卡绑定和解绑需要一段时间，请稍后操作！', rules)
    expect(r3.l1).toBe('资源锁定&并发冲突')
  })

  it('11-17 绑定状态类（B桶 6 组措辞）→ 资源状态异常', () => {
    const r1 = classifyPatrolRootCause('该公网IP已绑定资源，不支持绑定其他资源，请检查后重新输入', rules)
    expect(r1.l1).toBe('资源状态异常')
    const r2 = classifyPatrolRootCause('port未绑定资源；code=PORT_BIND_RESOURCE_NOT_FOUND', rules)
    expect(r2.l1).toBe('资源状态异常')
  })

  it('11-17 计费/订单策略（C桶 4 组措辞）→ 业务冲突', () => {
    const r = classifyPatrolRootCause('按量或一次性订单不支持续订；code=GLOBAL_REST_BIZ_OPERATION', rules)
    expect(r.l1).toBe('业务冲突')
    const r2 = classifyPatrolRootCause('当前接口暂不支持IP与关联的共享带宽一起退订', rules)
    expect(r2.l1).toBe('业务冲突')
  })

  it('11-17 参数缺失（D桶 4 组措辞）→ 参数无效&校验失败', () => {
    const r1 = classifyPatrolRootCause('resourceId字段为必填参数，请重新输入；code=GLOBAL_REST_BIZ_PARAM_INCOMPLETE', rules)
    expect(r1.l1).toBe('参数无效&校验失败')
    const r2 = classifyPatrolRootCause('公网IP的类型不能为空；code=GLOBAL_REST_BIZ_PARAM_INCOMPLETE', rules)
    expect(r2.l1).toBe('参数无效&校验失败')
  })

  it('11-17 资源不存在（E桶措辞）→ 资源状态异常', () => {
    const r = classifyPatrolRootCause('该路由器不存在；code=CSLOPENSTACK_NETWORK_VROUTER', rules)
    expect(r.l1).toBe('资源状态异常')
  })

  it('11-17 无失败语义日志（F/G桶 25 组形态）→ extractDiagnosticText 返回空 → 诊断能力缺口', () => {
    // MCP 返回的 records 无 ERROR/WARN 行且无 errorMessage/errorCode 片段 → 提取层应判「无失败语义」返回空
    const raw = JSON.stringify({ code: '0000', msg: null, tip: '成功', data: { records: [
      { ip: '10.1.1.1', content: '[2026-11-10 16:49:38.531] [ INFO] [7] [o-18080-exec-36] [reqId-8b8a5fdc]  调用方法: execution(ReturnMessage com.chin)' },
      { ip: '10.1.1.1', content: '[2026-11-10 16:49:38.532] [ INFO] [7] [o-18080-exec-36] []  RequestIdHeaderFilter获取header中的requestId' },
    ] } })
    const text = extractDiagnosticText(raw, '', false)
    expect(text).toBe('')   // 无失败语义 → 空文本
    const r = classifyPatrolRootCause(text, rules)
    expect(r.l1).toBe('诊断能力缺口')
  })
})
