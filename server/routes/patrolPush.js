/**
 * API 巡检推送路由（docs/DESIGN-API巡检.md §3）。
 * 鉴权：全局钩子验 API Key → 路由 preHandler 验 scope patrol:push（mcp.js 同模式）。
 * 幂等：唯一键 upsert 后到覆盖；响应入库摘要；不做诊断（异步）。
 * 写入核心已抽至 patrolIngestion.js（P0-4：HTTP 推送与 Plan B 邮件导入共用同一写入函数）。
 */
import { apiKeyHasScope } from '../apiKeyRepository.js'
import { logAuditFromRequest } from '../audit.js'
import { isValidPatrolDate, resolvePatrolProductKey } from '../patrolDomain.js'
import { ingestPatrolStats, ingestPatrolRequests, loadPatrolCatalogShared } from '../patrolIngestion.js'

const PUSH_BODY_LIMIT = 16 * 1024 * 1024
const PUSH_MAX_ROWS = 5000

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

  /** 产品目录（名称→key 映射真源；patrolIngestion.js 共享）。 */
  const loadCatalog = () => loadPatrolCatalogShared()

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

    const result = ingestPatrolStats({ date: body.date, productKey, rows: body.rows })

    logAuditFromRequest(request, 'api_patrol.push_stats', {
      product: body.product, productKey, date: body.date,
      received: body.rows.length, ...result,
    })
    return { received: body.rows.length, ...result }
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

    const result = ingestPatrolRequests({ date: body.date, pool: body.pool, pkg: body.package, rows: body.rows })

    logAuditFromRequest(request, 'api_patrol.push_requests', {
      package: body.package, date: body.date, pool: body.pool,
      received: body.rows.length, ...result,
      unregistered: result.unregistered,
    })
    return { received: body.rows.length, ...result, unregistered: result.unregistered }
  })
}
