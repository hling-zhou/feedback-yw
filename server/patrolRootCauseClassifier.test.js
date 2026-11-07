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
    // 黄金表（设计 §6.3，2026-11-07 回放定稿）
    expect(counts['诊断能力缺口/日志缺失/无数据']).toBe(1968)
    expect(counts['参数无效/校验失败/域名与比较类型成对']).toBe(1786)
    expect(counts['资源锁定/并发冲突/锁定机制待查']).toBe(113)
    expect(counts['资源锁定/并发冲突/并发进行中']).toBe(96)
    expect(counts['业务冲突/绑定关系未解除']).toBe(38)
    expect(counts['资源状态异常/负载均衡器本体']).toBe(18)
    expect(counts['其他/未归类/兜底']).toBe(16)
    expect(counts['配额不足/通用配额']).toBe(16)
    expect(counts['业务冲突/HAVIP绑定业务校验']).toBe(12)
    expect(counts['诊断能力缺口/日志无ERROR/WARN']).toBe(11)
    expect(counts['参数无效/校验失败/IP/资源ID/地址类']).toBe(6)
    expect(counts['配额不足/HAVIP数量上限']).toBe(5)
    expect(counts['诊断能力缺口/仅WARN结论不明']).toBe(5)
    expect(counts['资源状态异常/后端服务器组']).toBe(2)
    expect(counts['业务冲突/资源被他人占用']).toBe(4)
    expect(counts['业务冲突/DNAT规则冲突']).toBe(1)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(4097)
    expect(pending).toBe(204)
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
    expect(r.l1).toBe('其他/未归类')
  })

  it('产品侧映射挂 L2 行：规则6并发进行中=—、规则7机制待查=待处理', () => {
    const r6 = classifyPatrolRootCause('资源正在执行其他操作，处于锁定状态，并发请求被拒', rules)
    expect(r6.productAction).toBe('—')
    const r7 = classifyPatrolRootCause('目标资源被锁定处于不可操作状态', rules)
    expect(r7.productAction).toBe('待处理')
  })
})
