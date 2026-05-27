import { IDB_NAME, IDB_SCHEMA_VERSION } from './schema.js'
import { upgradeSchema, STORES } from './schema.js'

/** @type {IDBDatabase | null} */
let browserDb = null

/** @type {Map<string, Map<string, unknown>> | null} */
let memoryStores = null

function useMemoryBackend() {
  return typeof indexedDB === 'undefined'
}

function ensureMemoryStores() {
  if (!memoryStores) {
    memoryStores = new Map(
      Object.values(STORES).map((name) => [name, new Map()]),
    )
  }
  return memoryStores
}

/**
 * @returns {Promise<IDBDatabase | null>}
 */
export async function openDatabase() {
  if (useMemoryBackend()) {
    ensureMemoryStores()
    return null
  }
  if (browserDb) return browserDb

  browserDb = await new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_SCHEMA_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (ev) => {
      upgradeSchema(/** @type {IDBOpenDBRequest} */ (ev.target).result)
    }
  })
  return browserDb
}

export function isMemoryBackend() {
  return useMemoryBackend()
}

/**
 * @param {string} storeName
 * @param {string} key
 */
export async function idbGet(storeName, key) {
  await openDatabase()
  if (memoryStores) {
    return memoryStores.get(storeName)?.get(key) ?? null
  }
  const db = /** @type {IDBDatabase} */ (browserDb)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

/**
 * @param {string} storeName
 * @param {unknown} value
 */
export async function idbPut(storeName, value) {
  await openDatabase()
  if (memoryStores) {
    const store = memoryStores.get(storeName)
    const keyPath =
      storeName === STORES.meta ? 'key' : 'id'
    const key = /** @type {Record<string, string>} */ (value)[keyPath]
    store?.set(key, value)
    return
  }
  const db = /** @type {IDBDatabase} */ (browserDb)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).put(value)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * @param {string} storeName
 * @param {string} key
 */
export async function idbDelete(storeName, key) {
  await openDatabase()
  if (memoryStores) {
    memoryStores.get(storeName)?.delete(key)
    return
  }
  const db = /** @type {IDBDatabase} */ (browserDb)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * @param {string} storeName
 * @returns {Promise<unknown[]>}
 */
export async function idbGetAll(storeName) {
  await openDatabase()
  if (memoryStores) {
    return [...(memoryStores.get(storeName)?.values() ?? [])]
  }
  const db = /** @type {IDBDatabase} */ (browserDb)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

/**
 * @param {string} storeName
 * @param {string} indexName
 * @param {IDBValidKey | IDBKeyRange} query
 */
export async function idbGetAllByIndex(storeName, indexName, query) {
  await openDatabase()
  if (memoryStores) {
    const all = await idbGetAll(storeName)
    return all.filter((item) => {
      const rec = /** @type {Record<string, unknown>} */ (item)
      if (indexName === 'by_period_source' && Array.isArray(query)) {
        return rec.insightPeriodId === query[0] && rec.dataSourceType === query[1]
      }
      return rec[indexName] === query
    })
  }
  const db = /** @type {IDBDatabase} */ (browserDb)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).index(indexName).getAll(query)
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

/**
 * 清空 object store 内全部记录
 * @param {string} storeName
 */
export async function idbClearStore(storeName) {
  await openDatabase()
  if (memoryStores) {
    memoryStores.get(storeName)?.clear()
    return
  }
  const db = /** @type {IDBDatabase} */ (browserDb)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** 测试用：重置连接 */
export async function resetDatabaseForTests() {
  if (browserDb) {
    browserDb.close()
    browserDb = null
  }
  memoryStores = null
}
