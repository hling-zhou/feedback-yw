import { requireAdmin } from '../middleware.js'
import { getUsageDb, getUsageStatsByMonth, getUsageMonths } from '../usageDb.js'
import { randomId } from '../../src/lib/randomId.js'
import { resolveUsageModule } from '../../src/lib/usageModuleMap.js'

/**
 * 路由→模块映射：真源在 src/lib/usageModuleMap.js（前后端共用，守卫测试对拍路由表）。
 * @param {string} pathname
 * @returns {{ module: string, page: string }}
 */
function resolveModuleFromPath(pathname) {
  const page = pathname.split('?')[0]
  return { module: resolveUsageModule(page), page }
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerUsageRoutes(app) {
  // 采集端点：不需要 requirePermission，只需登录（preHandler 已校验 JWT）
  app.post('/api/usage/track', async (request, reply) => {
    try {
      const body = /** @type {{ module?: string; page?: string; params?: Record<string, unknown> }} */ (
        request.body || {}
      )

      // 优先用前端传入的 module，否则从 page 解析
      let module = body.module
      let page = body.page || ''
      if (!module && page) {
        const resolved = resolveModuleFromPath(page)
        module = resolved.module
        page = page
      }
      if (!module) {
        reply.code(400).send({ error: '缺少 module 或 page' })
        return
      }

      const user = request.user
      const db = getUsageDb()
      db.prepare(
        `INSERT INTO usage_stats (id, user_id, username, team, role, module, page, params_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomId(),
        user?.id ?? null,
        user?.username ?? 'anonymous',
        user?.team ?? '',
        user?.role ?? '',
        module,
        page,
        JSON.stringify(body.params ?? {}),
        new Date().toISOString(),
      )

      return { ok: true }
    } catch (err) {
      request.log.error(err)
      return reply.code(500).send({ error: '记录访问失败' })
    }
  })

  // 查询端点：仅管理员
  app.get('/api/usage/stats', { preHandler: requireAdmin() }, async (request) => {
    const q = /** @type {{ month?: string }} */ (request.query || {})
    const month = q.month || undefined
    const rows = getUsageStatsByMonth(month)
    return { rows, month: month || 'current' }
  })

  // 查询可用月份列表：仅管理员
  app.get('/api/usage/months', { preHandler: requireAdmin() }, async () => {
    return { months: getUsageMonths() }
  })
}
