/**
 * 审计脚本：共享谓词绕过检测（防缺陷触发规则 3 的代码化）
 *
 * 背景（2026-11-06 五问题复盘）：同一业务概念（已纳入/勾选等）在 UI 多处呈现时，
 * 必须全部走同一个判定函数——各处内联实现会随功能叠加口径漂移，出现过
 * "Tag 显示 12 条、筛选结果 0 条""行显示勾选、按钮说没勾"类矛盾。
 *
 * 本脚本扫描 src/ 下是否绕过已抽出的共享谓词、直接摸底层数据结构：
 *   - archivedKeys.has(...)    → 应走 isArchived（含周期包含匹配）
 *   - archivedItems.get(...)   → 应走 archivedInfoOf
 *   - dispatchedKeys.has(...)  → 应走 isDispatched（含周期包含匹配）
 *   - decisions.get(...)       → 应走 decisionOf（含周期包含 + 合并语义）
 * 共享谓词定义体内（fast-path）属合法白名单。
 *
 * 用法：
 *   node scripts/audit-shared-predicates.mjs        # 有绕过 exit 1（可接 CI）
 *   新抽共享谓词后往 SHARED_PREDICATES 清单里追加概念即可扩展。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = path.resolve(__dirname, '../src')

/**
 * 共享谓词登记表：概念 → { predicate, patterns[] }
 * 新抽共享谓词后在此追加；patterns 是"绕过形态"（直接摸底层结构）。
 */
const SHARED_PREDICATES = [
  {
    concept: '已纳入产品部回溯',
    predicate: 'isArchived',
    patterns: ['archivedKeys.has(', 'archivedItems.get('],
  },
  {
    concept: '已纳入省代表回访',
    predicate: 'isDispatched',
    patterns: ['dispatchedKeys.has('],
  },
  {
    concept: '清单勾选状态',
    predicate: 'decisionOf',
    patterns: ['decisions.get('],
  },
]

/** 合法判定：出现点向上 WINDOW 行内存在白名单函数声明（共享谓词定义体 fast-path） */
const ALLOWED_CONTEXTS = new Set([
  'isArchived',
  'archivedInfoOf',
  'isDispatched',
  'decisionOf',
  'lookupBySubset',
  'allMatchingKeys',
])
const WINDOW = 15

function walkJsFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walkJsFiles(full, acc)
    } else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name)) {
      acc.push(full)
    }
  }
  return acc
}

/**
 * 判定某行是否在共享谓词定义体内：向上 WINDOW 行内出现
 * `const NAME = useCallback(`/`function NAME(` 且 NAME 在白名单。
 * （首版教训：按"最近函数声明"跟踪会把 useCallback 之后到下一个声明之间的
 * 组件体代码误归入谓词上下文，导致真实绕过漏报——窗口法对此鲁棒。）
 */
function isInsideAllowedContext(lines, lineIdx) {
  const declRe = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:useCallback|async|function)|(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/
  for (let i = lineIdx; i >= Math.max(0, lineIdx - WINDOW); i -= 1) {
    const m = lines[i].match(declRe)
    if (m) {
      const name = m[1] || m[2]
      if (ALLOWED_CONTEXTS.has(name)) return true
      return false // 更近的声明不是白名单函数 → 顶层/组件体
    }
  }
  return false
}

function main() {
  const violations = []
  for (const file of walkJsFiles(SRC_ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const { concept, predicate, patterns } of SHARED_PREDICATES) {
      for (const pattern of patterns) {
        lines.forEach((line, i) => {
          if (!line.includes(pattern)) return
          if (isInsideAllowedContext(lines, i)) return
          const rel = path.relative(path.resolve(__dirname, '..'), file)
          violations.push(
            `${rel}:${i + 1} 绕过 ${predicate}（概念「${concept}」直摸底层结构 ${pattern}…）→ ${line.trim().slice(0, 120)}`,
          )
        })
      }
    }
  }

  if (violations.length) {
    console.error(`✗ 共享谓词绕过 ${violations.length} 处（同源判定纪律，见 docs/conventions/防缺陷触发规则.md）：\n`)
    for (const v of violations) console.error('  ' + v)
    process.exit(1)
  }
  console.log(`✓ 共享谓词审计通过：${SHARED_PREDICATES.length} 个概念无内联绕过（isArchived/isDispatched/decisionOf）`)
}

main()
