/**
 * API 巡检数据写入共享模块（docs/DESIGN-API巡检.md §9 P0-4）。
 *
 * 从 routes/patrolPush.js 抽取 stats/requests upsert 核心，供两条路径复用：
 * 1. HTTP 推送路由（patrolPush.js）
 * 2. Plan B 邮件拉取导入（patrolEmailIngestion.js）——进程内直调，
 *    不经过 HTTP 层（消灭 API Key 自签名回路）
 *
 * 两条路径写入同一唯一键 upsert，幂等/去重/审计口径一致（§9.1：可并存，后到覆盖）。
 */
import { getDb } from './db.js'
import { storageRepository } from './storageRepository.js'
import { loadManagedProductCatalog } from '../src/storage/productCatalogStore.js'
import { normalizeElbRow, normalizeEipVpcRow, parsePercent, resolveRequestProductKey } from './patrolDomain.js'

/** @typedef {import('./patrolSeeds.js').PatrolApiRegistryItem} PatrolApiRegistryItem */

/** meta 适配器（loadManagedProductCatalog 需要的 getMeta/putMeta 形态）。 */
const metaAdapter = {
  getMeta: (key) => storageRepository.getMeta(key),
  putMeta: (key, value) => storageRepository.putMeta(key, value),
}

/**
 * 读注册表（meta 单源；storageRepository.getMeta 已返回解析对象）。
 * @returns {PatrolApiRegistryItem[]}
 */
export function readPatrolRegistryItemsShared() {
  const parsed = storageRepository.getMeta('api_patrol_api_registry_v1')
  return /** @type {PatrolApiRegistryItem[]} */ (parsed && Array.isArray(parsed.items) ? parsed.items : [])
}

/**
 * 加载产品目录（名称→key 映射真源）。
 * 先 loadManagedProductCatalog 刷新（防进程内缓存陈旧——10-25 根因先例）。
 * @returns {Promise<{ key: string, name: string }[]>}
 */
export async function loadPatrolCatalogShared() {
  await loadManagedProductCatalog(metaAdapter)
  const parsed = storageRepository.getMeta('product_catalog_managed_v1')
  return /** @type {{ key: string, name: string }[]} */ (parsed?.products || [])
}

/**
 * 未登记接口告警追加（设计 §5.1 待登记持久化）。
 * @param {string} apiPath
 */
export function appendUnregisteredApi(apiPath) {
  const parsed = storageRepository.getMeta('api_patrol_unregistered_apis_v1')
  const items = parsed && Array.isArray(parsed.items) ? [...parsed.items] : []
  if (!items.includes(apiPath)) {
    items.push(apiPath)
    storageRepository.putMeta(
      'api_patrol_unregistered_apis_v1',
      { version: 1, updatedAt: new Date().toISOString(), items },
    )
  }
}

/**
 * 写入异常接口统计数据（等价于 POST /api/patrol/push/stats 的核心逻辑）。
 * 幂等：唯一键 (stat_date, product_key, pool_name, api_path, metric_name) upsert 后到覆盖。
 *
 * @param {{ date: string, productKey: string, rows: Record<string, string>[] }} params
 * @returns {{ inserted: number, overwritten: number, ignored: number }}
 */
export function ingestPatrolStats({ date, productKey, rows }) {
  const db = getDb()
  const upsert = db.prepare(`
    INSERT INTO api_patrol_stats
      (stat_date, product_key, pool_name, metric_name, api_path, biz_type, success_rate,
       duration_normal_ratio, avg_duration, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stat_date, product_key, pool_name, api_path, metric_name)
    DO UPDATE SET
      success_rate=excluded.success_rate,
      duration_normal_ratio=excluded.duration_normal_ratio,
      avg_duration=excluded.avg_duration,
      updated_at=excluded.updated_at
  `)

  const now = new Date().toISOString()
  let inserted = 0
  let overwritten = 0
  let ignored = 0

  for (const row of rows) {
    const pool = String(row['资源池'] || '').trim()
    const metric = String(row['指标名称'] || '').trim()
    const apiPath = String(row['接口名称'] || '').trim()
    const bizType = String(row['业务类型'] || '').trim()
    const rate = parsePercent(row['成功率'])
    if (!pool || !metric || !apiPath || !bizType || rate == null || Number.isNaN(rate)) {
      ignored += 1
      continue
    }
    const ratio = parsePercent(row['正常比例'])
    const avgDuration = String(row['时长均值'] || '').trim()

    const existed = db.prepare(`
      SELECT 1 FROM api_patrol_stats WHERE stat_date=? AND product_key=? AND pool_name=? AND api_path=? AND metric_name=?
    `).get(date, productKey, pool, apiPath, metric)

    upsert.run(
      date, productKey, pool, metric, apiPath, bizType, rate,
      ratio == null || Number.isNaN(ratio) ? null : ratio,
      avgDuration && avgDuration !== '-' ? avgDuration : null,
      now, now,
    )
    if (existed) overwritten += 1
    else inserted += 1
  }

  return { inserted, overwritten, ignored }
}

/**
 * 写入请求明细数据（等价于 POST /api/patrol/push/requests 的核心逻辑）。
 * 幂等：唯一键 (request_date, pool_name, request_id) upsert 后到覆盖；批内去重后者覆盖前者。
 *
 * @param {{ date: string, pool: string, pkg: 'eip_vpc' | 'elb', rows: Record<string, string>[] }} params
 * @returns {{ inserted: number, overwritten: number, ignored: number, unregistered: string[] }}
 */
export function ingestPatrolRequests({ date, pool, pkg, rows }) {
  const db = getDb()
  const registry = readPatrolRegistryItemsShared()

  const upsert = db.prepare(`
    INSERT INTO api_patrol_requests
      (external_row_id, request_date, pool_name, product_key, request_id, api_path,
       user_id, user_name, is_success, duration_ms, request_time, end_time,
       biz_category, biz_target, biz_no, error_message, pushed_diagnose,
       app_id, daily_report, realtime_report, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_date, pool_name, request_id)
    DO UPDATE SET
      external_row_id=excluded.external_row_id,
      product_key=excluded.product_key,
      api_path=excluded.api_path,
      user_id=excluded.user_id,
      user_name=excluded.user_name,
      is_success=excluded.is_success,
      duration_ms=excluded.duration_ms,
      request_time=excluded.request_time,
      end_time=excluded.end_time,
      biz_category=excluded.biz_category,
      biz_target=excluded.biz_target,
      biz_no=excluded.biz_no,
      error_message=excluded.error_message,
      pushed_diagnose=excluded.pushed_diagnose,
      app_id=excluded.app_id,
      daily_report=excluded.daily_report,
      realtime_report=excluded.realtime_report,
      created_at=excluded.created_at
  `)

  const now = new Date().toISOString()
  let inserted = 0
  let overwritten = 0
  let ignored = 0
  const unregistered = new Set()
  /** 批内去重（§3.5：后者覆盖前者） */
  const seen = new Set()

  for (const raw of rows) {
    const normalized = pkg === 'elb'
      ? normalizeElbRow(/** @type {Record<string, string>} */ (raw))
      : normalizeEipVpcRow(/** @type {Record<string, string>} */ (raw))
    if (!normalized) {
      ignored += 1
      continue
    }
    const firstInBatch = !seen.has(normalized.requestId)
    if (firstInBatch) seen.add(normalized.requestId)

    let productKey = null
    if (pkg === 'elb') {
      productKey = 'slb'
    } else {
      const resolved = resolveRequestProductKey(normalized.apiPath, registry)
      productKey = resolved.productKey
      if (resolved.heuristic && normalized.apiPath) {
        unregistered.add(normalized.apiPath)
      }
    }

    const existed = db.prepare(`
      SELECT 1 FROM api_patrol_requests WHERE request_date=? AND pool_name=? AND request_id=?
    `).get(date, pool, normalized.requestId)

    upsert.run(
      normalized.externalRowId, date, pool, productKey, normalized.requestId,
      normalized.apiPath, normalized.userId, normalized.userName, normalized.isSuccess,
      normalized.durationMs, normalized.requestTime, normalized.endTime,
      normalized.bizCategory, normalized.bizTarget, normalized.bizNo,
      normalized.errorMessage, normalized.pushedDiagnose, normalized.appId,
      raw.dailyReport != null ? String(raw.dailyReport) : null,
      raw.realtimeReport != null ? String(raw.realtimeReport) : null,
      now,
    )
    if (existed || !firstInBatch) {
      overwritten += 1
    } else {
      inserted += 1
    }
  }

  for (const apiPath of unregistered) appendUnregisteredApi(apiPath)

  return { inserted, overwritten, ignored, unregistered: [...unregistered] }
}
