import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * UI 规范守卫（2026-11-07 apiPatrol 两页间距不一致复盘产物）。
 *
 * 全站 UI 单源（src/index.css）：
 * - 页面四周间距由外壳 `.app-shell-content` 统一提供（px-3→sm:px-4→lg:px-5 响应式），
 *   页面组件**不得自包 padding**——外层容器一律 `space-y-4`（Actions 等 7 页先例）；
 * - 页面卡片一律 `page-card`（rounded-lg bg-white p-4），不得用 antd `<Card>`
 *   （body 24px / title 16px 均偏离全站体系）；
 * - 卡片标题一律 `page-card-header` + `page-card-title`（14px/600/ink-900，
 *   2026-11-01 用户拍板字号终版），不得用 `Typography.Title level={5}`（16px）。
 *
 * 检测范围：API 巡检前端全域（pages/ApiPatrol* + components/apiPatrol + tagManagement/ApiPatrol*）。
 * 历史存量（Operations 的 p-6、Import 等 10 文件的 Title level={5}、McpGuide/Operations/Feedbacks
 * 的页面级 Card）不在本守卫范围——是否统一由用户另行拍板；**新写的巡检前端文件**必须守规。
 *
 * 豁免（弹窗标题白名单）：自定义 Modal 的标题用 Typography.Title level={5}（16px/600）
 * 是 antd Modal title 默认样式的合理近似，层级高于卡片标题（14px）合理——仅允许以下
 * 已知弹窗表达式，新增弹窗标题时在此追加。
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

/** API 巡检前端全域文件收集 */
function collectPatrolFrontendFiles() {
  /** @type {Array<{file: string, rel: string}>} */
  const out = []
  for (const file of listJsxFiles(SRC)) {
    const rel = relative(ROOT, file)
    if (
      /^src\/pages\/ApiPatrol(About)?[\w-]*\.jsx$/.test(rel)
      || /^src\/components\/apiPatrol\//.test(rel)
      || /^src\/components\/tagManagement\/ApiPatrol[\w-]*\.jsx$/.test(rel)
    ) {
      out.push({ file, rel })
    }
  }
  return out
}

/** 反模式 ①：页面/面板自包 p-6 容器（双倍间距 + 不响应式） */
const P6_PATTERN = /className="p-6[ "]/

/** 反模式 ②：antd Card 当页面卡片（应为 page-card 体系） */
const ANTD_CARD_PATTERN = /<Card[ >]/

/** 反模式 ③：Typography.Title level={5} 当卡片标题（应为 page-card-title 14px） */
const TITLE5_PATTERN = /Typography\.Title level=\{5\}/

/** 弹窗标题白名单（antd Modal title 16px 默认的合理近似） */
const MODAL_TITLE_ALLOWLIST = [
  "{isNew ? '新增规则' : '编辑规则'}",
  "{initial.apiPath ? '编辑接口' : '新增接口'}",
]

describe('UI 规范守卫（apiPatrol 前端全域 · 11-07 复盘产物）', () => {
  const files = collectPatrolFrontendFiles()

  it('守卫覆盖非空（扫描器失效时红——防恒绿假守卫）', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('① 页面/面板不得自包 p-6 容器（四周间距由外壳 app-shell-content 统一提供）', () => {
    /** @type {Array<{ file: string, line: number }>} */
    const violations = []
    for (const { file, rel } of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (P6_PATTERN.test(line)) violations.push({ file: rel, line: i + 1 })
      })
    }
    expect(violations).toEqual([])
  })

  it('② 页面卡片不得用 antd <Card>（应为 page-card + page-card-header/title 体系）', () => {
    /** @type {Array<{ file: string, line: number }>} */
    const violations = []
    for (const { file, rel } of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (ANTD_CARD_PATTERN.test(line)) violations.push({ file: rel, line: i + 1 })
      })
    }
    expect(violations).toEqual([])
  })

  it('③ 卡片标题不得用 Typography.Title level={5}（弹窗标题白名单除外）', () => {
    /** @type {Array<{ file: string, line: number, line2: string }>} */
    const violations = []
    for (const { file, rel } of files) {
      const source = readFileSync(file, 'utf8')
      const lines = source.split('\n')
      lines.forEach((line, i) => {
        if (!TITLE5_PATTERN.test(line)) return
        // 弹窗标题豁免：Title level={5} 后 2 行内命中白名单表达式
        const context = lines.slice(i, i + 3).join('\n')
        const allowed = MODAL_TITLE_ALLOWLIST.some((expr) => context.includes(expr))
        if (!allowed) violations.push({ file: rel, line: i + 1, line2: line.trim().slice(0, 80) })
      })
    }
    expect(violations).toEqual([])
  })
})
