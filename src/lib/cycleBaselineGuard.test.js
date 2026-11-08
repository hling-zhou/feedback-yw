import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 循环依赖基线守卫（11-08 会诊 E——环群栅栏）。
 *
 * 背景：打标域存在巨型环群（overridePolicy↔applyThemes↔manualTagFields 等，
 * 会诊时 madge 式枚举 59 条环路径、约 25 个文件参与）。环在 ESM 下运行时无害，
 * 代价是改动半径失控与「叠加不审计」——历史上环无声增长无人知晓。
 *
 * 拍板口径：**不重构拆环**（打标链是系统心脏，重构风险大于环的当前实际损害），
 * 立**增长栅栏**：环指标登记入仓（scripts/cycle-baseline.txt），只许拆不许加。
 *
 * 指标选型（为什么不是"环路径数"）：路径枚举是指数级行为（第一版实现已被
 * SIGTERM 证伪——1200 文件规模跑不完）。改用 Tarjan 强连通分量算法，
 * 基线指标 = **非平凡 SCC（size>1）的内部边总数**。它是环增长的严格单调代理：
 * 任何新增环边必然落入某个 SCC（新建或扩大），内部边数严格 +1 以上；
 * 拆环边必然减少。既能机器强制又 O(V+E) 秒级。
 *
 * 守卫边界声明：动态 import() 不入图（集中在测试文件与路由层懒加载，
 * 对 domain/lib 环群影响极小，取舍已记录）；测试文件（*.test.*）不入图。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCAN_DIRS = ['src', 'server']
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'data', 'coverage', 'e2e-data'])
const BASELINE_FILE = join(ROOT, 'scripts', 'cycle-baseline.txt')

/** @returns {string[]} */
function listSourceFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...listSourceFiles(p))
    } else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) {
      out.push(p)
    }
  }
  return out
}

/**
 * 解析单文件的相对路径静态 import 边。
 * @param {string} file
 * @returns {string[]}
 */
function resolveImportEdges(file) {
  const source = readFileSync(file, 'utf8')
  /** @type {string[]} */
  const deps = []
  const patterns = [
    /import\s+[^'"]*?from\s+['"](\.[^'"]+)['"]/g,
    /import\s+['"](\.[^'"]+)['"]/g,
    /export\s+[^'"]*?from\s+['"](\.[^'"]+)['"]/g,
    /require\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ]
  /** @type {Set<string>} */
  const seen = new Set()
  for (const re of patterns) {
    let m
    while ((m = re.exec(source))) {
      const spec = m[1]
      if (seen.has(spec)) continue
      seen.add(spec)
      const base = resolve(dirname(file), spec)
      for (const c of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, join(base, 'index.js'), join(base, 'index.jsx')]) {
        if (existsSync(c) && statSync(c).isFile()) {
          deps.push(c)
          break
        }
      }
    }
  }
  return deps
}

/**
 * Tarjan 强连通分量。返回 SCC 列表（每个是节点数组）。
 * @param {Map<string, string[]>} graph
 * @returns {string[][]}
 */
function tarjanSCC(graph) {
  let index = 0
  /** @type {Map<string, number>} */
  const indices = new Map()
  /** @type {Map<string, number>} */
  const lowlink = new Map()
  /** @type {Set<string>} */
  const onStack = new Set()
  /** @type {string[]} */
  const stack = []
  /** @type {string[][]} */
  const sccs = []

  const strongconnect = (/** @type {string} */ v) => {
    indices.set(v, index)
    lowlink.set(v, index)
    index += 1
    stack.push(v)
    onStack.add(v)

    for (const w of graph.get(v) || []) {
      if (!indices.has(w)) {
        strongconnect(w)
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)))
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)))
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      /** @type {string[]} */
      const scc = []
      let w
      do {
        w = stack.pop()
        onStack.delete(w)
        scc.push(w)
      } while (w !== v)
      sccs.push(scc)
    }
  }

  for (const v of graph.keys()) {
    if (!indices.has(v)) strongconnect(v)
  }
  return sccs
}

/**
 * 建图 + 计算 SCC 环指标。
 * @returns {{ sccs: string[][], internalEdges: number, bigSccs: { nodes: string[], edges: number }[], edges: Array<[string, string]> }}
 */
function analyzeCycles() {
  const files = SCAN_DIRS.flatMap((d) => {
    const p = join(ROOT, d)
    return existsSync(p) ? listSourceFiles(p) : []
  })
  const fileSet = new Set(files)
  /** @type {Map<string, string[]>} */
  const graph = new Map()
  for (const f of files) {
    graph.set(f, resolveImportEdges(f).filter((d) => fileSet.has(d)))
  }

  const sccs = tarjanSCC(graph)
  /** @type {Array<[string, string]>} */
  let internalEdges = 0
  /** @type {{ nodes: string[], edges: number }[]} */
  const bigSccs = []
  /** @type {Array<[string, string]>} */
  const internalEdgeList = []

  for (const scc of sccs) {
    if (scc.length < 2) continue
    const members = new Set(scc)
    let edges = 0
    for (const node of scc) {
      for (const dep of graph.get(node) || []) {
        if (members.has(dep)) {
          edges += 1
          internalEdgeList.push([node, dep])
        }
      }
    }
    internalEdges += edges
    bigSccs.push({
      nodes: scc.map((n) => relative(ROOT, n)).sort(),
      edges,
    })
  }
  bigSccs.sort((a, b) => b.edges - a.edges)
  return { sccs, internalEdges, bigSccs, edges: internalEdgeList }
}

describe('循环依赖基线守卫（会诊 E：环只许拆不许加）', () => {
  const analysis = analyzeCycles()

  it('基线文件在位且格式合法', () => {
    expect(existsSync(BASELINE_FILE)).toBe(true)
    const content = readFileSync(BASELINE_FILE, 'utf8')
    const m = content.match(/^CYCLE_SCC_INTERNAL_EDGES=(\d+)$/m)
    expect(m, 'scripts/cycle-baseline.txt 缺 CYCLE_SCC_INTERNAL_EDGES= 行').not.toBeNull()
  })

  it(`环指标不得超过基线（当前实测 SCC 内部边 = ${analysis.internalEdges}）`, () => {
    const content = readFileSync(BASELINE_FILE, 'utf8')
    const m = content.match(/^CYCLE_SCC_INTERNAL_EDGES=(\d+)$/m)
    const baseline = Number(m[1])
    expect(
      analysis.internalEdges,
      `检测到新增环依赖（SCC 内部边 ${analysis.internalEdges} > 基线 ${baseline}）。
处置三选一：
① 改设计：将共享函数抽到环外文件（推荐）
② 依赖倒置：被依赖方通过参数/回调接收，不 import 环上文件
③ 确认接受新环：更新 scripts/cycle-baseline.txt 的 CYCLE_SCC_INTERNAL_EDGES 并在 commit message 说明理由（diff 评审必答）

当前最大 SCC（内部边数 / 文件数）：
${analysis.bigSccs.slice(0, 3).map((s) => `  edges=${s.edges}, nodes=${s.nodes.length}: ${s.nodes.slice(0, 5).join(', ')}${s.nodes.length > 5 ? '…' : ''}`).join('\n')}`,
    ).toBeLessThanOrEqual(baseline)
  })

  it('守卫自身有效性自检：必须检出已知的 overridePolicy 巨型环群（防退化成假守卫）', () => {
    const overrideScc = analysis.bigSccs.find((s) =>
      s.nodes.some((n) => n.includes('overridePolicy')),
    )
    expect(
      overrideScc,
      '未检出已知存在的 overridePolicy 环群——守卫解析规则可能失效（假守卫形态），需修复守卫本身',
    ).not.toBeNull()
    expect(overrideScc.nodes.length).toBeGreaterThan(5)
  })
}, 120000)
