import { getApiStorageAdapter } from './apiStorageAdapter.js'

/** @typedef {import('./adapter.js').StorageAdapter} StorageAdapter */

/**
 * 已登录场景下使用服务端共享存储。
 * @returns {StorageAdapter}
 */
export function getStorageAdapter() {
  return getApiStorageAdapter()
}
