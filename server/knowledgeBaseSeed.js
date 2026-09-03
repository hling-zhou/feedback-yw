import fs from 'node:fs'
import path from 'node:path'
import { countKnowledgeBases, upsertKnowledgeBase } from './knowledgeBaseRepository.js'
import { clearKnowledgeBaseCache } from './knowledgeBaseLoader.js'

function resolveKnowledgeBaseDir() {
  return process.env.KNOWLEDGE_BASE_DIR || path.join(process.cwd(), 'data', '接知识库')
}

/**
 * 启动时一次性把文件系统中的 KB seed 入库（仅当 DB 为空）。
 * @returns {Promise<{ seeded: number; skipped: boolean }>}
 */
export async function seedKnowledgeBasesIfEmpty() {
  try {
    if (countKnowledgeBases() > 0) {
      return { seeded: 0, skipped: true }
    }
  } catch (err) {
    console.warn('[kb-seed] 检查 KB 数量失败，跳过 seed:', err)
    return { seeded: 0, skipped: true }
  }

  const dir = resolveKnowledgeBaseDir()
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { seeded: 0, skipped: false }
  }

  let seeded = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let files = []
    try {
      files = fs.readdirSync(path.join(dir, entry.name))
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('_biz_knowledge_base.json')) continue
      try {
        const raw = fs.readFileSync(path.join(dir, entry.name, file), 'utf8')
        const data = JSON.parse(raw)
        const productLine = String(data?.productLine ?? '').trim().toLowerCase()
        if (!productLine) continue
        upsertKnowledgeBase({
          productKey: productLine,
          productName: String(data?.productName ?? ''),
          exportDate: String(data?.exportDate ?? ''),
          payload: raw,
          user: { username: 'system-seed' },
        })
        seeded += 1
      } catch (err) {
        console.warn(`[kb-seed] 导入 ${file} 失败:`, err)
      }
    }
  }

  if (seeded > 0) {
    clearKnowledgeBaseCache()
    console.info(`[kb-seed] 已从文件系统 seed ${seeded} 个知识库入库`)
  }
  return { seeded, skipped: false }
}
