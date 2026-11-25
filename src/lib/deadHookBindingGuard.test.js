import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 无消费死代码守卫（2026-11-25 万投比 tab 丢失 72 天复盘产物）。
 *
 * 由来：c5e92f3（9/13 全局白色卡片规范）把 antd Card 换成 div.page-card 时，
 * Card 上的 tabList/activeTabKey/onTabChange 三个行为 props 无处可挂被静默丢弃——
 * 但 tabList 的 useMemo 声明、activeProductKey 的 useState 全都完好存活，只是不再被
 * 渲染消费。typecheck/既有测试对此形态天然失明（无未定义引用、无语法错误），
 * 72 天后用户进设置页才被发现。本守卫扫的正是这个形态：
 * **hooks 产出的绑定在文件内零消费 = 大概率是某次重构吞掉了消费端**。
 *
 * 扫描规则（词边界引用计数，声明行自身除外）：
 * - `const [x, setX] = useState(...)`：x 文件内零引用即红（setter 有引用不算）；
 * - `const x = useMemo/useCallback(...)`：x 零引用即红；
 * - `const x = useRef(...)`：x 零引用即红。
 * 排除形态（合法场景，不报）：
 * - 解构出的非标识符名（含类型标注、默认值等）；
 * - 声明在 export 函数体内但被 props 透传——词边界引用已覆盖 prop 引用场景；
 * - 豁免清单（见 EXEMPTIONS）：历史遗留孤儿，随改随清，新增不豁免。
 *
 * 红绿纪律：本守卫的红绿证明含历史 blob 注入——用 c5e92f3 当天的真实 bug 形态
 * （tabList 零消费）作为 fixture 验证当天即红，修复形态零命中。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = join(ROOT, 'src')

/** @returns {string[]} */
function listJsxFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...listJsxFiles(p))
    } else if (name.endsWith('.jsx') && !name.includes('.test.')) {
      out.push(p)
    }
  }
  return out
}

const HOOK_ARRAY_RE = /const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*[A-Za-z_$][\w$]*\s*\]\s*=\s*use(?:State|Reducer)\s*\(/g
const HOOK_SINGLE_RE = /const\s+([A-Za-z_$][\w$]*)\s*=\s*use(?:Memo|Callback|Ref)\s*\(/g

/**
 * @param {string} text
 * @returns {{ name: string, kind: string }[]}
 */
export function findUnconsumedHookBindings(text) {
  /** @type {{ name: string, kind: string }[]} */
  const findings = []
  for (const re of [
    [HOOK_ARRAY_RE, 'useState/useReducer'],
    [HOOK_SINGLE_RE, 'useMemo/useCallback/useRef'],
  ]) {
    for (const m of text.matchAll(re[0])) {
      const name = m[1]
      const rest = text.replace(m[0], '', 1)
      if (!new RegExp(`\\b${name}\\b`).test(rest)) {
        findings.push({ name, kind: re[1] })
      }
    }
  }
  return findings
}

/**
 * 豁免清单（历史孤儿，随改随清——文件因功能改动被打开时顺手删除声明）：
 * - PostUseHtmlReport.jsx 六处：11-20 V1 报告下线/10-17 trendSnap 移除的孤儿声明，
 *   V2 有等价机制（V2 生成路径 ...(prev[key]||{}) 保留人工编辑；保存直接写
 *   issues: issueNarratives），无功能丢失，仅死代码待清。
 * - InsightsContext.jsx reprocessAllTagsCore（5/28 引入的客户端批量重打标核心，
 *   187 行）：批量任务服务端化（/api/storage/records/enrich 后台任务）后整体
 *   绕过，startBulkRetag 不再调用——服务端有等价实现，无功能丢失，死代码待专项清理。
 */
const EXEMPTIONS = new Map([
  [
    'src/pages/PostUseHtmlReport.jsx',
    new Set(['manualIssueFields', 'productNames', 'focusNames', 'ticketRecords', 'scopedVisits', 'periodMonths']),
  ],
  ['src/context/InsightsContext.jsx', new Set(['reprocessAllTagsCore'])],
])

describe('无消费死代码守卫（hooks 绑定零引用扫描 · 11-25 万投比 tab 复盘产物）', () => {
  it('守卫覆盖非空（扫描器失效时红——防恒绿假守卫）', () => {
    const files = listJsxFiles(SRC)
    expect(files.length).toBeGreaterThan(100)
    // 扫描器自检：已知消费形态不报、已知死形态报
    const clean = "const [a, setA] = useState(0)\nconsole.log(a)\nconst b = useMemo(() => 1, [])\nuseX(b)"
    expect(findUnconsumedHookBindings(clean)).toEqual([])
    const dead = "const [dead1, setDead1] = useState(0)\nconst dead2 = useMemo(() => 1, [])\nsetDead1(1)"
    expect(findUnconsumedHookBindings(dead).map((f) => f.name)).toEqual(['dead1', 'dead2'])
  })

  it('历史 bug 形态注入（c5e92f3 当天的 tabList 零消费）→ 红', () => {
    const { execFileSync } = require('node:child_process')
    const blob = execFileSync('git', ['show', 'c5e92f3:src/components/ProductWanTouMetricsPanel.jsx'], {
      cwd: ROOT,
      encoding: 'utf-8',
    })
    const hits = findUnconsumedHookBindings(blob).map((f) => f.name)
    expect(hits).toContain('tabList')
  })

  it('src/ 全域 jsx 无未豁免的死 hooks 绑定', () => {
    /** @type {string[]} */
    const violations = []
    for (const file of listJsxFiles(SRC)) {
      const rel = relative(ROOT, file)
      const findings = findUnconsumedHookBindings(readFileSync(file, 'utf-8'))
      const exempt = EXEMPTIONS.get(rel) ?? new Set()
      for (const f of findings) {
        if (!exempt.has(f.name)) {
          violations.push(`${rel}: ${f.name} (${f.kind}) 文件内零消费`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
