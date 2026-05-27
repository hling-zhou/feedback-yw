import { storageRepository } from './storageRepository.js'

export const META_KEY_DATA_REVISION = 'data_revision'

/**
 * @returns {{ revision: number; updatedAt: string | null }}
 */
export function getDataRevision() {
  const v = storageRepository.getMeta(META_KEY_DATA_REVISION)
  if (v && typeof v === 'object' && 'revision' in v) {
    return /** @type {{ revision: number; updatedAt: string | null }} */ (v)
  }
  return { revision: 0, updatedAt: null }
}

/** @type {ReturnType<typeof setTimeout> | null} */
let bumpTimer = null

function commitBump() {
  const prev = getDataRevision()
  const next = {
    revision: (prev.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  storageRepository.putMeta(META_KEY_DATA_REVISION, next)
  return next
}

/**
 * 任意共享业务数据变更后调用，供其他客户端轮询感知（400ms 无新写入后合并为一次版本号递增）。
 */
export function bumpDataRevision() {
  if (bumpTimer) clearTimeout(bumpTimer)
  bumpTimer = setTimeout(() => {
    bumpTimer = null
    commitBump()
  }, 400)
}
