import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 表单必填标记守卫（2026-11-04 用户拍板全局约束——必填项必须有必填标记）。
 *
 * 检测形态：手写字段标签（`Typography.Text type="secondary" ... mb-1 block ...` 灰色小字标签）
 * 后 3 行内紧跟输入控件（Input / Select / Radio.Group / TextArea）= 表单字段——
 * 该标签必须带 `text-red-500`（红星）或改用 FieldLabel 组件；否则报缺口。
 *
 * 豁免：只读展示区（标签后跟非输入内容）天然不匹配；antd Form.Item required 自带 *。
 * 新增表单漏必填标记时本守卫红——修复方式：required → FieldLabel 或补红 *。
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
    } else if (name.endsWith('.jsx')) {
      out.push(p)
    }
  }
  return out
}

/** 手写灰色字段标签后紧跟输入控件的行号提取 */
const LABEL_PATTERN = /type="secondary"[^>]*className="[^"]*mb-1 block[^"]*"/
const INPUT_PATTERN = /<(Input|Select|Radio\.Group|DatePicker|Input\.TextArea|InputNumber|TreeSelect)\b/

/** 筛选器/可选控件形态（出现即豁免——非必填表单）：allowClear 可清空、placeholder 声明"可选" */
const OPTIONAL_CONTROL_PATTERN = /allowClear|placeholder="[^"]*可选/

/**
 * 文件级豁免清单（人工判定为"非提交型表单"——筛选器/配置面板，字段均有默认值非必填）：
 * - workbench/DimensionQuantityTrendPanel：图表维度筛选器（有默认值，切换即重算，无提交动作）
 * - pages/Import：列映射行组件自带 required && 红星机制（守卫正则匹配到其 hint 行属误报）
 */
const FILE_EXEMPTIONS = new Set([
  'src/components/workbench/DimensionQuantityTrendPanel.jsx',
  'src/pages/Import.jsx',
])

describe('表单必填标记守卫（通用约束 11-04）', () => {
  it('手写字段标签 + 输入控件组合必须带必填标记（红 * 或 FieldLabel）', () => {
    /** @type {Array<{ file: string, line: number, label: string }>} */
    const violations = []
    for (const file of listJsxFiles(SRC)) {
      const rel = relative(ROOT, file)
      if (FILE_EXEMPTIONS.has(rel)) continue
      const source = readFileSync(file, 'utf8')
      const lines = source.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        if (!LABEL_PATTERN.test(lines[i])) continue
        // 标签文本（下一行内容）
        const labelText = (lines[i + 1] || '').trim()
        // 后 4 行内出现输入控件 = 表单字段
        const window = lines.slice(i + 1, i + 5).join('\n')
        if (!INPUT_PATTERN.test(window)) continue
        // 已带红 *（标签行或文本行或标签前一行——Import 模式 required && <span>）→ 合规
        if (
          lines[i].includes('text-red-500') ||
          (lines[i + 1] || '').includes('text-red-500') ||
          (lines[i - 1] || '').includes('text-red-500')
        ) {
          continue
        }
        // （FieldLabel 组件形态不会匹配 LABEL_PATTERN——无需文件级豁免；此前文件级豁免
        //  会让"同文件混用 FieldLabel 与旧灰字标签"的漏标记逃逸，已删。）
        // 筛选器形态（allowClear / placeholder"可选"）→ 非必填表单，豁免
        if (OPTIONAL_CONTROL_PATTERN.test(window)) continue
        violations.push({
          file: rel,
          line: i + 1,
          label: labelText.replace(/[<>]/g, '').slice(0, 30),
        })
      }
    }
    const detail = violations.map((v) => `${v.file}:${v.line}（${v.label}）`).join('\n')
    expect(
      violations,
      `以下表单字段标签缺必填标记（修复：required 用 <FieldLabel required> 或补 <span className="text-red-500">*</span>）：\n${detail}`,
    ).toEqual([])
  })
})
