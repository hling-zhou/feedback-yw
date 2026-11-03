import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 抽屉叠加语义守卫（2026-11-04 用户拍板全局约定——抽屉内开工单详情一律"叠加"不"替换"）。
 *
 * 约定：任何业务抽屉（zIndex 1000）内点工单号 → 工单详情抽屉（FeedbackDrawer
 * zIndex 1010）盖在其上，关闭后宿主抽屉必须仍在。禁止打开详情时关闭宿主抽屉
 * （旧"替换"式会让宿主消失，还会静默丢宿主表单编辑）。
 *
 * 检测形态：所有 onOpenTicket / onOpenRecord / onOpenFeedback 注入点
 * （内联箭头函数 或 本地标识符传递），解析 handler 实现体，其中不得出现
 * "宿主关闭"形态的 setter 调用：set\w+(false) / setEditing(null) / setDetailOpen(false) 等。
 *
 * 豁免：
 * - 纯转发（体内只有透传调用/void 包装，无语句）天然合规；
 * - 组件间 prop 透传（onOpenTicket={onOpenTicket}）→ 追溯到页面级注入点再检查；
 * - 测试文件不扫描。
 *
 * 新增"点工单时关掉自己抽屉"的写法时本守卫红——修复方式：删掉关闭语句，保持叠加。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = join(ROOT, 'src')

/** @returns {string[]} */
function listSourceFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...listSourceFiles(p))
    } else if (name.endsWith('.jsx') || name.endsWith('.js')) {
      if (name.includes('.test.') || name.includes('.spec.')) continue
      out.push(p)
    }
  }
  return out
}

/** 注入点 prop 名（组件树上的开工单回调） */
const OPEN_PROP_PATTERN = /\bonOpen(?:Ticket|Record|Feedback)\s*=\s*\{/
/** 内联 handler：onOpenXxx={(...) => { body }} 或 (…) => expr */
const INLINE_ARROW_PATTERN = /\bonOpen(?:Ticket|Record|Feedback)\s*=\s*\{\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*/
/** 语句型 setter 调用（关闭宿主抽屉的形态）：setXxx(false) / setEditing(null) / setDetailOpen(false) … */
const HOST_CLOSE_PATTERN = /set[A-Z]\w*\(\s*(?:false|null)\s*\)/

/**
 * 提取注入点 handler 的函数体（尽力而为的文本解析，非 AST）：
 * 1) 内联箭头 → 从 "=>" 后取平衡花括号块（或到行尾的表达式）；
 * 2) 本地标识符（onOpenTicket={openFeedbackByTicketId}）→ 定位同文件内
 *    "const <name> = useCallback(...)" 声明，取其函数体。
 * @param {string} source
 * @param {number} propIdx 注入点在 source 中的起始位置
 * @returns {string | null} handler 体文本；无法解析时返回 null（跳过）
 */
function extractHandlerBody(source, propIdx) {
  const arrowMatch = INLINE_ARROW_PATTERN.exec(source.slice(propIdx, propIdx + 400))
  if (arrowMatch) {
    const bodyStart = propIdx + arrowMatch.index + arrowMatch[0].length
    return readBalancedBody(source, bodyStart)
  }
  // 本地标识符传递：onOpenXxx={someIdentifier}
  const identMatch = /\bonOpen(?:Ticket|Record|Feedback)\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(
    source.slice(propIdx, propIdx + 200),
  )
  if (identMatch) {
    const name = identMatch[1]
    if (name === 'undefined' || name === 'true') return null
    // 定位同文件声明：const name = useCallback(async (…) => { … }, […]) 或 function name(…) {…}
    const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:useCallback\\(\\s*)?(?:async\\s*)?(?:\\([^)]*\\)|[^=]{0,40})\\s*=>\\s*`, 'g')
    let m
    let lastBody = null
    while ((m = decl.exec(source)) !== null) {
      lastBody = readBalancedBody(source, m.index + m[0].length) || lastBody
    }
    return lastBody
  }
  return null
}

/** 从 start 开始读取平衡的 {...} 块（或单表达式到最近 , 或 }）；返回体内文本 */
function readBalancedBody(source, start) {
  const rest = source.slice(start)
  if (rest.startsWith('{')) {
    let depth = 0
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '{') depth += 1
      else if (rest[i] === '}') {
        depth -= 1
        if (depth === 0) return rest.slice(1, i)
      }
    }
    return null
  }
  // 表达式体：取到第一个顶层 , 或 }（prop 列表边界）
  const m = /^([^,}]*)/.exec(rest)
  return m ? m[1] : null
}

describe('抽屉叠加语义守卫（通用约定 11-04：抽屉内开工单一律叠加不替换）', () => {
  it('所有开工单注入点的 handler 体内不得出现宿主抽屉关闭调用', () => {
    /** @type {Array<{ file: string, line: number, evidence: string }>} */
    const violations = []
    for (const file of listSourceFiles(SRC)) {
      const rel = relative(ROOT, file)
      const source = readFileSync(file, 'utf8')
      const propPattern = new RegExp(OPEN_PROP_PATTERN.source, 'g')
      let match
      while ((match = propPattern.exec(source)) !== null) {
        const propIdx = match.index
        const body = extractHandlerBody(source, propIdx)
        if (body == null) continue
        if (HOST_CLOSE_PATTERN.test(body)) {
          const line = source.slice(0, propIdx).split('\n').length
          const lineText = (source.split('\n')[line - 1] || '').trim()
          violations.push({ file: rel, line, evidence: lineText.slice(0, 60) })
        }
      }
    }
    const detail = violations.map((v) => `${v.file}:${v.line}（${v.evidence}）`).join('\n')
    expect(
      violations,
      `以下"开工单"handler 内含宿主抽屉关闭调用（违反叠加约定——修复：删除关闭语句，工单详情抽屉应叠加在宿主之上）：\n${detail}`,
    ).toEqual([])
  })
})
