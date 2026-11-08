import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * BATCH_KEYS 批容器白名单守卫（11-08 会诊 P2-2）。
 *
 * 背景（82742ef 事故）：打标类消费方的模型提示词约定返回 {"results":[...]} /
 * {"keep":[...]} 等批容器形态；pickBatchResultContainer 白名单命中时保留容器，
 * 否则退化为粘连启发式（取最后完整对象）→ 批量答案整体丢失。
 *
 * 漂移形态：新消费方在 prompt 里承诺新容器键（如 {"groups":[...]}），
 * 但 BATCH_KEYS 白名单没加 → 批容器识别静默失效 → 又一次批量答案丢失。
 * 本守卫把「prompt 承诺的键」与「白名单」锁死：出现白名单外的容器键承诺即红。
 *
 * 判定口径：扫描 src/lib 生产代码（排除 test）prompt 文本中的
 * `{"key":[...]}` 承诺形态——键在白名单外即违例。
 * 已知豁免（各自有专用解析分支，不走批容器启发式）：
 *   - tools（pickAssistantPayload 专用 tools 分支，llmClient.js:324）
 *   - productOptimizations / serviceOptimizations（ticketOptimizationLLM 专用字段消费）
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIB_DIR = join(ROOT, 'src', 'lib')

// 从 llmClient.js 源码解析 BATCH_KEYS 真源（防守卫内复制副本漂移——双字段纪律）
const LLM_CLIENT_SOURCE = readFileSync(join(LIB_DIR, 'llmClient.js'), 'utf8')
const BATCH_KEYS_MATCH = LLM_CLIENT_SOURCE.match(/const BATCH_KEYS = \[([^\]]+)\]/)
const BATCH_KEYS = (BATCH_KEYS_MATCH?.[1] || '')
  .split(',')
  .map((s) => s.trim().replace(/['"]/g, ''))
  .filter(Boolean)
/** 有专用解析分支、不走批容器识别的键（豁免需写明代码依据） */
const EXEMPT_KEYS = new Set([
  'tools', // llmClient.js:324 pickAssistantPayload 专用 tools 分支
  'productOptimizations', // ticketOptimizationLLM.js:66 专用字段消费（joinOptimizations）
  'serviceOptimizations', // 同上
])

/** @returns {string[]} */
function listLibJsFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...listLibJsFiles(p))
    } else if (name.endsWith('.js') && !name.includes('.test.')) {
      out.push(p)
    }
  }
  return out
}

describe('BATCH_KEYS 批容器白名单守卫（会诊 P2-2）', () => {
  it('prompt 承诺的批容器键必须在 pickBatchResultContainer 白名单内', () => {
    /** @type {Array<{ file: string, line: number, key: string }>} */
    const violations = []
    for (const file of listLibJsFiles(LIB_DIR)) {
      const rel = file.slice(ROOT.length + 1)
      // llmClient.js 自身是白名单定义处，跳过（含注释与启发式示例文本）
      if (rel === 'src/lib/llmClient.js') continue
      const source = readFileSync(file, 'utf8')
      const lines = source.split('\n')
      lines.forEach((line, i) => {
        // 匹配 prompt 文本中的 {"key":[...]} 承诺形态（含模板串转义形态 \"key\":[）
        const re = /\{\\?"([a-zA-Z]+)\\?"\s*:\s*\\?\[/g
        let m
        while ((m = re.exec(line))) {
          const key = m[1]
          if (BATCH_KEYS.includes(key)) continue
          if (EXEMPT_KEYS.has(key)) continue
          violations.push({ file: rel, line: i + 1, key })
        }
      })
    }
    expect(
      violations.map((v) => `${v.file}:${v.line} → "${v.key}"`),
      `发现 BATCH_KEYS 白名单外的批容器键承诺——pickBatchResultContainer 不会识别这些容器，
批量答案会退化为粘连启发式（取最后完整对象）→ 整批丢失（82742ef 同款事故形态）。
处置二选一：
① 该键确属批结果容器 → 加入 llmClient.js BATCH_KEYS 白名单 + llmClient.test.js 契约用例
② 该键有专用解析分支 → 加入本守卫 EXEMPT_KEYS 并注明代码依据
违例清单：
${violations.map((v) => `  ${v.file}:${v.line} → "${v.key}"`).join('\n')}`,
    ).toEqual([])
  })

  it('守卫防退化自检：known-good（results/keep）与 known-bad（groups）判定正确', () => {
    const good = /\{\\?"([a-zA-Z]+)\\?"\s*:\s*\\?\[/.exec('只返回 JSON：{\\"results\\":[{...}]}')
    expect(good?.[1]).toBe('results')
    const bad = /\{\\?"([a-zA-Z]+)\\?"\s*:\s*\\?\[/.exec('只返回 JSON：{"groups":["a"]}')
    expect(bad?.[1]).toBe('groups')
    expect(BATCH_KEYS).not.toContain('groups')
  })
})
