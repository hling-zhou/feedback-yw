#!/usr/bin/env node
/**
 * 清理 dist/ 根目录的流水线/测试产物（2026-11-09）。
 *
 * 背景：规则生产副驾等流水线脚本把中间产物写进 dist/（与 Vite 构建产物同目录），
 * Nginx 静态托管时这些文件会被一并伺服出去（4MB 的 evidence-rows.json 等），
 * 既浪费带宽也暴露内部数据。构建后统一清掉。
 *
 * 边界（不可越）：
 * - 只清 dist/ 根下的**已知产物白名单**（与 server/routes/storage.js 的
 *   pipeline artifacts 白名单 + 只读样本对齐），不递归、不模糊匹配；
 * - dist/assets/、dist/config/ 是 Vite/public 的合法构建产物，一概不动。
 *
 * 幂等：文件不存在时静默跳过；跑多少次结果一致。
 */
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

const DIST_DIR = join(process.cwd(), 'dist')

/** 与 server/routes/storage.js pipeline artifacts 白名单同源对齐 + 只读样本。 */
const PIPELINE_ARTIFACTS = [
  'evidence-rows.json',
  'gate-report.json',
  'taxonomy-current.json',
  'pipeline-summary.json',
  'sample-tickets.csv',
]

const removed = []
const skipped = []

for (const name of PIPELINE_ARTIFACTS) {
  const filePath = join(DIST_DIR, name)
  try {
    await unlink(filePath)
    removed.push(name)
  } catch (/** @type {any} */ err) {
    if (err?.code === 'ENOENT') {
      skipped.push(name)
    } else {
      console.error(`[clean-dist] 删除失败 ${name}:`, err?.message || err)
      process.exitCode = 1
    }
  }
}

if (removed.length > 0) console.log(`[clean-dist] 已清理 dist/ 流水线产物: ${removed.join(', ')}`)
if (skipped.length > 0) {
  // 静默跳过是常态（CI/全新构建），不打扰
}
