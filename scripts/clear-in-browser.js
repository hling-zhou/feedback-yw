/**
 * 【遗留 / 仅本机】在【当前已打开的应用标签页】DevTools → Console 中粘贴执行，
 * 清空浏览器 IndexedDB 与旧版 localStorage 反馈键。不会清空服务端 SQLite 共享库。
 *
 * 共享环境请使用：登录 → 设置 → 清空全部数据。
 */
;(async () => {
  const DB = 'feedback-insights-v2'
  const stores = ['records', 'snapshots', 'analysis_runs', 'artifacts', 'artifacts_debug']
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB)
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
        if (db.objectStoreNames.contains(name)) tx.objectStore(name).clear()
      }
    }
  })
  localStorage.removeItem('feedback-insights-records')
  console.log('已清空', stores.join(', '), '；请按 F5 刷新页面')
})()
