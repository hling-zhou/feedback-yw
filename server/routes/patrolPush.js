/**
 * API 巡检推送路由（docs/DESIGN-API巡检.md §3）。
 * 鉴权：全局钩子验 API Key → 路由 preHandler 验 scope patrol:push（mcp.js 同模式）。
 * 幂等：唯一键 upsert 后到覆盖；响应入库摘要；不做诊断（异步）。
 */
import { apiKeyHasScope } from '../apiKeyRepository.js'
import { logAuditFromRequest } from '../audit.js'
import { storageRepository } from '../storageRepository.js'
import { getDb } from '../db.js'
import { loadManagedProductCatalog } from '../../src/storage/productCatalogStore.js'
import {
  isValidPatrolDate,
  normalizeElbRow,
  normalizeEipVpcRow,
  parsePercent,
  resolvePatrolProductKey,
  resolveRequestProductKey,
} from '../patrolDomain.js'

const PUSH_BODY_LIMIT = 16 * 1024 * 1024
const PUSH_MAX_ROWS = 5000

/** @typedef {import('./patrolSeeds.js').PatrolApiRegistryItem} PatrolApiRegistryItem */

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerPatrolPushRoutes(app) {
  /** push 端点专用：scope 校验（全局钩子已验 API Key 有效性） */
  const requirePatrolPushScope = async (request, reply) => {
    if (!request.apiKey || !apiKeyHasScope(request.apiKey, /** @type {'patrol:push'} */ ('patrol:push'))) {
      return reply.code(403).send({ error: '缺少 patrol:push 权限（API Key 需配置该 scope）' })
    }
    return undefined
  }

  /** 读注册表种子/运营数据（meta 单源；storageRepository.getMeta 已返回解析对象）。 */
  const readRegistryItems = () => {
    const parsed = storageRepository.getMeta('api_patrol_api_registry_v1')
    return /** @type {PatrolApiRegistryItem[]} */ (parsed && Array.isArray(parsed.items) ? parsed.items : [])
  }

  /** 未登记接口告警追加（设计 §5.1 待登记持久化；getMeta 返回对象）。 */
  const appendUnregistered = (apiPath) => {
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

  /** 产品目录（名称→key 映射真源；getMeta 返回对象）。 */
  const loadCatalog = async () => {
    const adapter = {
      getMeta: (key) => storageRepository.getMeta(key),
      putMeta: (key, value) => storageRepository.putMeta(key, value),
    }
    await loadManagedProductCatalog(adapter)
    const parsed = storageRepository.getMeta('product_catalog_managed_v1')
    return /** @type {{ key: string, name: string }[]} */ (parsed?.products || [])
  }

  app.post('/api/patrol/push/stats', {
    preHandler: requirePatrolPushScope,
    bodyLimit: PUSH_BODY_LIMIT,
  }, async (request, reply) => {
    const body = /** @type {{ product?: string, date?: string, rows?: Record<string, string>[] }} */ (request.body || {})
    if (!body.product || !body.date || !Array.isArray(body.rows)) {
      return reply.code(400).send({ error: '缺少必填字段：product / date / rows' })
    }
    if (!isValidPatrolDate(body.date)) {
      return reply.code(400).send({ error: `date 格式非法：${body.date}（要求 YYYY-MM-DD）` })
    }
    const catalog = await loadCatalog()
    const productKey = resolvePatrolProductKey(body.product, catalog)
    if (!productKey) {
      return reply.code(400).send({ error: `未知产品：${body.product}（按产品目录 name/key 均未匹配）` })
    }
    if (body.rows.length > PUSH_MAX_ROWS) {
      return reply.code(413).send({ error: `单批行数超上限 ${PUSH_MAX_ROWS}（当前 ${body.rows.length}）` })
    }

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
    for (const row of body.rows) {
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
      `).get(body.date, productKey, pool, apiPath, metric)
      upsert.run(body.date, productKey, pool, metric, apiPath, bizType, rate,
        ratio == null || Number.isNaN(ratio) ? null : ratio,
        avgDuration && avgDuration !== '-' ? avgDuration : null, now, now)
      if (existed) overwritten += 1
      else inserted += 1
    }

    logAuditFromRequest(request, 'api_patrol.push_stats', {
      product: body.product, productKey, date: body.date,
      received: body.rows.length, inserted, overwritten, ignored,
    })
    return { received: body.rows.length, inserted, overwritten, ignored }
  })

  app.post('/api/patrol/push/requests', {
    preHandler: requirePatrolPushScope,
    bodyLimit: PUSH_BODY_LIMIT,
  }, async (request, reply) => {
    const body = /** @type {{ package?: string, date?: string, pool?: string, rows?: Record<string, string>[] }} */ (request.body || {})
    if (!body.package || !body.date || !body.pool || !Array.isArray(body.rows)) {
      return reply.code(400).send({ error: '缺少必填字段：package / date / pool / rows' })
    }
    if (body.package !== 'eip_vpc' && body.package !== 'elb') {
      return reply.code(400).send({ error: `package 非法：${body.package}（要求 eip_vpc | elb）` })
    }
    if (!isValidPatrolDate(body.date)) {
      return reply.code(400).send({ error: `date 格式非法：${body.date}（要求 YYYY-MM-DD）` })
    }
    if (body.rows.length > PUSH_MAX_ROWS) {
      return reply.code(413).send({ error: `单批行数超上限 ${PUSH_MAX_ROWS}（当前 ${body.rows.length}）` })
    }

    const db = getDb()
    const registry = readRegistryItems()
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
    /** 批内去重（§3.5：后者覆盖前者，received 计去重后） */
    const seen = new Set()

    for (const raw of body.rows) {
      const normalized = body.package === 'elb'
        ? normalizeElbRow(/** @type {Record<string, string>} */ (raw))
        : normalizeEipVpcRow(/** @type {Record<string, string>} */ (raw))
      if (!normalized) {
        ignored += 1
        continue
      }
      const firstInBatch = !seen.has(normalized.requestId)
      if (firstInBatch) seen.add(normalized.requestId)
      let productKey = null
      if (body.package === 'elb') {
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
      `).get(body.date, body.pool, normalized.requestId)
      upsert.run(
        normalized.externalRowId, body.date, body.pool, productKey, normalized.requestId,
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

    for (const apiPath of unregistered) appendUnregistered(apiPath)

    logAuditFromRequest(request, 'api_patrol.push_requests', {
      package: body.package, date: body.date, pool: body.pool,
      received: seen.size + ignored, inserted, overwritten, ignored,
      unregistered: [...unregistered],
    })
    return { received: seen.size + ignored, inserted, overwritten, ignored, unregistered: [...unregistered] }
  })
}
