import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * typecheck 基线快照守卫（11-08 会诊 D-4，半裸奔纪律补防）。
 *
 * 背景：项目存在约 4000 个历史 typecheck 错误（TS2339 为主，JSDoc 类型宽松），
 * 「零新增」纪律在如此噪音下人工比对几乎不可行（会诊 P3 判定半裸奔）。
 *
 * 守卫口径（三层）：
 *   ① 致命类零容忍：TS2304（找不到名）/TS2307（找不到模块）/TS2552（undefined 名）
 *     ——这三类代表引用断裂（跨组件作用域 bug 形态），无论历史基线如何都不允许出现；
 *   ② 快照只许降不许升：scripts/typecheck-baseline.txt 按文件记录历史错误数，
 *     任何文件错误数增长即红；修掉错误后应更新快照（数字变小）；
 *   ③ 新文件零错误：基线里没有的文件若出现错误即红（新增代码不允许带病入库）。
 *
 * 维护：修复某文件的历史错误后，重跑 `npx tsc -p tsconfig.json --noEmit` 生成
 * 聚合并更新 scripts/typecheck-baseline.txt（数字只会越来越少）。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_FILE = join(ROOT, 'scripts/typecheck-baseline.txt')

/** @returns {{ counts: Map<string, number>, critical: string[] }} file → error count */
function runTypecheck() {
  /** @type {Map<string, number>} */
  const counts = new Map()
  /** @type {string[]} */
  const critical = []
  let raw = ''
  try {
    raw = execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '' },
    })
  } catch (err) {
    // tsc 有错误时退出码非 0，输出在 err.stdout
    raw = (err && err.stdout) || ''
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^(.+?)\(\d+,\d+\):\s+error\s+(TS\d+):/)
    if (!m) continue
    const [, file, code] = m
    counts.set(file, (counts.get(file) || 0) + 1)
    if (code === 'TS2304' || code === 'TS2307' || code === 'TS2552') {
      critical.push(line.trim())
    }
  }
  return { counts, critical }
}

/** @returns {Map<string, number>} */
function readBaseline() {
  /** @type {Map<string, number>} */
  const baseline = new Map()
  for (const line of readFileSync(BASELINE_FILE, 'utf8').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/)
    if (m) baseline.set(m[2], Number(m[1]))
  }
  return baseline
}

// 4027 历史错误下 tsc 较慢（约 30-60s）——守卫本身允许长超时
describe('typecheck 基线快照守卫（会诊 D-4：致命类零容忍 + 快照只降不升 + 新文件零错误）', () => {
  const { counts, critical } = runTypecheck()

  it('致命类零容忍：TS2304/TS2307/TS2552（引用断裂）不允许出现', () => {
    expect(
      critical,
      `发现引用断裂类错误（新增代码不允许带断引用入库）：\n${critical.slice(0, 10).join('\n')}`,
    ).toEqual([])
  })

  it('快照只降不升：任何文件的历史错误数不得增长（增长即未遵守零新增纪律）', () => {
    const baseline = readBaseline()
    /** @type {string[]} */
    const regressed = []
    for (const [file, count] of counts) {
      const base = baseline.get(file)
      if (base != null && count > base) {
        regressed.push(`${file}: ${base} → ${count}（+${count - base}）`)
      }
    }
    expect(
      regressed,
      `以下文件的历史 typecheck 错误数增长（零新增纪律违例；若为误报请重生成 scripts/typecheck-baseline.txt）：\n${regressed.join('\n')}`,
    ).toEqual([])
  })

  it('新文件零错误：基线未收录的文件不允许出现任何 typecheck 错误', () => {
    const baseline = readBaseline()
    /** @type {string[]} */
    const newOffenders = []
    for (const [file, count] of counts) {
      if (!baseline.has(file) && count > 0) {
        newOffenders.push(`${file}: ${count} 个错误`)
      }
    }
    expect(
      newOffenders,
      `以下新文件带 typecheck 错误入库（新代码零错误；修复后或有意收录请更新 scripts/typecheck-baseline.txt）：\n${newOffenders.slice(0, 15).join('\n')}`,
    ).toEqual([])
  })
}, 180000)
