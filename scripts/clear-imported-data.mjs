/**
 * 【遗留】仅清空浏览器内 IndexedDB / 旧版 localStorage，不会删除服务端 SQLite 中的共享数据。
 *
 * 日常使用请登录应用 →「设置」→「清空全部数据」（调用 API DELETE /api/storage/imported-data）。
 *
 * 本脚本用于无头页清本地 IDB（无法清空你正在用的 Chrome/Cursor 标签页）。
 * 若已全面使用 API 存储，优先用设置页清空，勿依赖本脚本。
 *
 * 用法：先 npm run dev:all，再 BASE_URL=http://127.0.0.1:5175 npm run clear:imported
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5175'
const DB_NAME = 'feedback-insights-v2'

async function clearInPage(page) {
  return page.evaluate(async (dbName) => {
    const stores = [
      'records',
      'snapshots',
      'analysis_runs',
      'artifacts',
      'artifacts_debug',
    ]
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(stores, 'readwrite')
        tx.oncomplete = () => {
          db.close()
          resolve(null)
        }
        tx.onerror = () => reject(tx.error)
        for (const name of stores) {
          if (db.objectStoreNames.contains(name)) {
            tx.objectStore(name).clear()
          }
        }
      }
    })
    try {
      localStorage.removeItem('feedback-insights-records')
    } catch {
      /* ignore */
    }
    return stores
  }, DB_NAME)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 })
  const cleared = await clearInPage(page)
  console.log(`已清空 IndexedDB（${DB_NAME}）: ${cleared.join(', ')}`)
  console.log('已清除 localStorage 历史反馈键 feedback-insights-records')
} catch (e) {
  console.error('清空失败:', e.message)
  console.error(`请确认前端已启动: npm run dev 或 npm run dev:all  (${BASE})`)
  process.exit(1)
} finally {
  await browser.close()
}
