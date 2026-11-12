import { storageRepository } from './storageRepository.js'

export const META_KEY_DATA_REVISION = 'data_revision'

/**
 * @returns {{ revision: number; recordsRevision: number; snapshotsRevision: number; updatedAt: string | null }}
 */
export function getDataRevision() {
  const v = storageRepository.getMeta(META_KEY_DATA_REVISION)
  if (v && typeof v === 'object' && 'revision' in v) {
    const row = /** @type {{ revision?: number; recordsRevision?: number; snapshotsRevision?: number; updatedAt?: string | null }} */ (v)
    return {
      revision: row.revision || 0,
      recordsRevision: row.recordsRevision || 0,
      snapshotsRevision: row.snapshotsRevision || 0,
      updatedAt: row.updatedAt || null,
    }
  }
  return { revision: 0, recordsRevision: 0, snapshotsRevision: 0, updatedAt: null }
}

/** @type {ReturnType<typeof setTimeout> | null} */
let bumpTimer = null
let pendingRecords = false
let pendingSnapshots = false

function commitBump() {
  const prev = getDataRevision()
  const bumpRecords = pendingRecords
  const bumpSnapshots = pendingSnapshots
  pendingRecords = false
  pendingSnapshots = false
  const next = {
    revision: (prev.revision || 0) + 1,
    recordsRevision: (prev.recordsRevision || 0) + (bumpRecords ? 1 : 0),
    snapshotsRevision: (prev.snapshotsRevision || 0) + (bumpSnapshots ? 1 : 0),
    updatedAt: new Date().toISOString(),
  }
  storageRepository.putMeta(META_KEY_DATA_REVISION, next)
  return next
}

/**
 * 任意共享业务数据变更后调用，供其他客户端轮询感知（400ms 无新写入后合并为一次版本号递增）。
 * @param {{ records?: boolean; snapshots?: boolean }} [options] records: 工单变更；snapshots: 完整快照已发布
 */
export function bumpDataRevision(options = {}) {
  if (options.records) pendingRecords = true
  if (options.snapshots) pendingSnapshots = true
  if (bumpTimer) clearTimeout(bumpTimer)
  bumpTimer = setTimeout(() => {
    bumpTimer = null
    commitBump()
  }, 400)
}

/** 导入 / 改工单 / 复原客户 / 改产品目录：同时递增 recordsRevision */
export function bumpRecordsRevision() {
  bumpDataRevision({ records: true })
}

export function bumpSnapshotsRevision() {
  bumpDataRevision({ snapshots: true })
}
