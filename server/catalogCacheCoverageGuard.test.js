import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产品目录缓存消费方覆盖守卫（11-08 会诊 #2，10-25 收件人 0 人事故防线）。
 *
 * 约定（项目拍板）：服务端任何消费方读 getCatalogProducts()（进程内缓存）前，
 * 必须保证目录已刷新——三选一：
 *   ① 自身调用前显式 loadManagedProductCatalog(...)
 *   ② 所在文件有「路由层负责刷新」契约注释，且调用链上游确有刷新（actionItemRepository 模式）
 *   ③ 由调用方传入 catalogProducts 参数（pass-through，如 enrichRunner options）
 * 否则「UI 保存目录只写 DB + 浏览器缓存」后，服务端消费方读到旧缓存
 * → 收件人 0 人 / MCP 映射漂移（10-25 与 11-08 两次真实事故形态）。
 *
 * 本守卫扫描 server/ 下所有 .js（排除 test），找 getCatalogProducts( 调用点，
 * 逐文件判定三选一覆盖；未覆盖即红。新增服务端消费方忘刷新时本守卫红。
 *
 * 豁免形态（豁免理由必须写明）：
 * - productCatalogLoader.js：定义处非消费（src/lib 侧，不在扫描范围）
 * - FILE_EXEMPTIONS：路由层上游刷新已核实（见各条注释）
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = join(ROOT, 'server')

/** @returns {string[]} */
function listServerJsFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'data') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...listServerJsFiles(p))
    } else if (name.endsWith('.js') && !name.includes('.test.')) {
      out.push(p)
    }
  }
  return out
}

/** 文件级豁免（判定理由见注释；豁免≠盲区——移出后守卫应精准红，见红绿证明） */
const FILE_EXEMPTIONS = new Set([
  // getCatalogProducts 消费点在 getPostUseJourneyTargets 路由内，同文件 :364 先 loadManagedProductCatalog
  'server/routes/storage.js',
  // :410 visit 摘要经 routes/storage.js 旅程计数路由调用，路由层已刷新（上游契约）
  'server/storageRepository.js',
])

describe('产品目录缓存消费方覆盖守卫（会诊 #2 / 10-25 事故防线）', () => {
  it('server/ 全部 getCatalogProducts 消费点必须有刷新覆盖（三选一）', () => {
    /** @type {string[]} */
    const violations = []
    for (const file of listServerJsFiles(SERVER)) {
      const rel = relative(SERVER, file)
      const source = readFileSync(file, 'utf8')

      const consumeMatches = [...source.matchAll(/\bgetCatalogProducts\s*\(/g)]
      if (!consumeMatches.length) continue

      const exemptKey = rel.startsWith('server/') ? rel : `server/${rel}`
      if (FILE_EXEMPTIONS.has(exemptKey)) continue

      // 三选一判定
      const selfRefresh = /loadManagedProductCatalog\s*\(/.test(source)
      const contractNote = /刷新.*路由层|由路由层负责|catalogProducts\s*\?\?/.test(source)
      const passThrough = /options\.catalogProducts/.test(source)

      if (selfRefresh || contractNote || passThrough) continue

      consumeMatches.forEach((m) => {
        const line = source.slice(0, m.index).split('\n').length
        violations.push(`${exemptKey}:${line}`)
      })
    }
    expect(
      violations,
      `以下 getCatalogProducts 消费点无刷新覆盖（修复三选一：①调用前 loadManagedProductCatalog ②路由层 refreshProductCatalog* 模式 ③options.catalogProducts 传入；豁免须在 FILE_EXEMPTIONS 写明理由）：\n${violations.join('\n')}`,
    ).toEqual([])
  })
})
