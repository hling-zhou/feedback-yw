import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paginationShowTotal } from './paginationTotal.js'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/** 递归收集 src 下所有 .jsx 文件 */
function collectJsxFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectJsxFiles(full))
    else if (entry.name.endsWith('.jsx')) out.push(full)
  }
  return out
}

/** 递归收集 src 下所有 .jsx/.js 文件（import 解析守卫用，须含 .js 守卫自身） */
function collectSourceFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectSourceFiles(full))
    else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

/**
 * 守卫：全仓活跃分页（pagination 对象形态）必须带 showTotal（2026-11-11 需求）。
 * 内联 `(x) => \`共 ...\`` 回调残留 = 违反同源纪律，必须迁移共享常量。
 */
describe('分页总数守卫（红绿守卫：新增活跃分页缺 showTotal / 内联回调回潮即红）', () => {
  it('paginationShowTotal 输出格式：共 N 条', () => {
    expect(paginationShowTotal(0)).toBe('共 0 条')
    expect(paginationShowTotal(48697)).toBe('共 48697 条')
  })

  it('全仓活跃分页对象形态必须带 showTotal', () => {
    const files = collectJsxFiles(path.join(rootDir, '../'))
    const violations = []
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!/pagination=\{\{/.test(line)) continue
        // 单行形态：同一行闭合
        if (/\}\}/.test(line)) {
          if (/showTotal/.test(line)) continue
          // pagination={{ }} 空对象也该有 showTotal（防御）——一律报
          violations.push(`${path.relative(rootDir, file)}:${i + 1} ${line.trim()}`)
        } else {
          // 多行形态：向下找收口，范围内无 showTotal 即违规
          const indent = line.match(/^(\s*)/)?.[1] || ''
          let j = i + 1
          let closed = false
          while (j < lines.length && j < i + 20) {
            if (/\}\}/.test(lines[j])) { closed = true; break }
            j++
          }
          if (!closed) continue // 无法定位收口，跳过（不误报）
          const block = lines.slice(i, j + 1).join('\n')
          if (!/showTotal/.test(block)) {
            violations.push(`${path.relative(rootDir, file)}:${i + 1} ${line.trim()}（多行块）`)
          }
        }
      }
    }
    expect(violations, `活跃分页缺 showTotal 的位置：\n${violations.join('\n')}`).toEqual([])
  })

  it('内联 showTotal 回调残留 = 0（必须用共享 paginationShowTotal）', () => {
    const files = collectJsxFiles(path.join(rootDir, '../'))
    const violations = []
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      const re = /showTotal:\s*\([a-zA-Z]*\)\s*=>/g
      let m
      while ((m = re.exec(src)) !== null) {
        const line = src.slice(0, m.index).split('\n').length
        violations.push(`${path.relative(rootDir, file)}:${line}`)
      }
    }
    expect(violations, `内联回调残留位置：\n${violations.join('\n')}`).toEqual([])
  })

  it('全仓消费方 import paginationTotal 逐一 resolve 必须成功（构建可用性守卫）', () => {
    // 背景：11-11 部署机构建炸于嵌套目录消费方 '../lib/...' 深度错误；
    // vitest 跑不起来/rollup 遍历序差异都会让这类断裂只在构建期暴露。此断言让
    // import 路径断裂在单测期即红，不再等到部署机构建失败才发现。
    const files = collectSourceFiles(path.join(rootDir, '../'))
    const violations = []
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      const re = /from\s+'([^']*paginationTotal[^']*)'/g
      let m
      while ((m = re.exec(src)) !== null) {
        const spec = m[1]
        // 相对路径：从消费方目录 resolve；裸名（node 内置/包名）跳过
        if (!spec.startsWith('.')) continue
        const resolved = path.resolve(path.dirname(file), spec)
        if (!fs.existsSync(resolved)) {
          const line = src.slice(0, m.index).split('\n').length
          violations.push(`${path.relative(rootDir, file)}:${line} → '${spec}' 无法解析`)
        }
      }
    }
    expect(violations, `paginationTotal import 路径断裂位置：\n${violations.join('\n')}`).toEqual([])
  })
})
