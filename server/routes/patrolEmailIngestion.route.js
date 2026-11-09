/**
 * API 巡检 Plan B 邮件拉取路由（docs/DESIGN-API巡检.md §9.6）。
 * - GET  /api/patrol/email-ingestion/status（view）——最近拉取状态（脱敏）
 * - PUT  /api/patrol/email-ingestion/config（manageTags）——配置维护
 * - POST /api/patrol/email-ingestion/fetch（manageTags，body {force?}）——手动拉取
 */
import { requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import {
  readEmailIngestionConfig,
  saveEmailIngestionConfig,
  readEmailIngestionState,
  runPatrolEmailIngestion,
} from '../patrolEmailIngestion.js'

/**
 * 状态脱敏（不含 auth code——auth code 只从环境变量读取，本就不进 meta）。
 */
const desensitizeState = (state) => {
  if (!state) return {}
  return {
    lastFetchAt: state.lastFetchAt,
    lastFetchDate: state.lastFetchDate,
    lastResult: state.lastResult,
    lastStats: state.lastStats,
    lastError: state.lastError ? String(state.lastError).slice(0, 300) : undefined,
  }
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerPatrolEmailIngestionRoutes(app) {
  app.get('/api/patrol/email-ingestion/status', { preHandler: requirePermission('view') }, async () => {
    return {
      enabled: readEmailIngestionConfig().enabled,
      state: desensitizeState(readEmailIngestionState()),
    }
  })

  app.get('/api/patrol/email-ingestion/config', { preHandler: requirePermission('view') }, async () => {
    // 脱敏：不回 auth code（它只从环境变量读取，从不入库）；imapUser 部分脱敏
    const c = readEmailIngestionConfig()
    return {
      enabled: c.enabled,
      imapHost: c.imapHost,
      imapPort: c.imapPort,
      imapUser: c.imapUser.replace(/^(.).*(@.*)$/, '$1***$2'),
      imapTls: c.imapTls,
      senderWhitelist: c.senderWhitelist,
      autoProcessOnFetch: c.autoProcessOnFetch,
      authCodeConfigured: Boolean(process.env.PATROL_EMAIL_AUTH_CODE),
    }
  })

  app.put('/api/patrol/email-ingestion/config', { preHandler: requirePermission('manageTags') }, async (request, reply) => {
    const body = /** @type {{enabled?: boolean, senderWhitelist?: string[], autoProcessOnFetch?: boolean}} */ (request.body || {})
    const prev = readEmailIngestionConfig()
    const next = {
      ...prev,
      enabled: body.enabled === true,
      // IMAP 连接参数（host/port/user）仅设计文档约定值+环境部署级维护，前端只切换开关/白名单/自动处理
      senderWhitelist: Array.isArray(body.senderWhitelist) && body.senderWhitelist.length > 0
        ? body.senderWhitelist.map(String).filter(Boolean)
        : prev.senderWhitelist,
      autoProcessOnFetch: body.autoProcessOnFetch !== false,
    }
    saveEmailIngestionConfig(next)
    logAuditFromRequest(request, 'api_patrol.email_ingestion_config_update', {
      enabledChanged: prev.enabled !== next.enabled,
      whitelistCount: next.senderWhitelist.length,
      autoProcessOnFetch: next.autoProcessOnFetch,
    })
    return {
      config: {
        enabled: next.enabled,
        imapHost: next.imapHost,
        imapPort: next.imapPort,
        imapUser: next.imapUser.replace(/^(.).*(@.*)$/, '$1***$2'),
        imapTls: next.imapTls,
        senderWhitelist: next.senderWhitelist,
        autoProcessOnFetch: next.autoProcessOnFetch,
        authCodeConfigured: Boolean(process.env.PATROL_EMAIL_AUTH_CODE),
      },
    }
  })

  app.post('/api/patrol/email-ingestion/fetch', { preHandler: requirePermission('manageTags') }, async (request, reply) => {
    const body = /** @type {{force?: boolean}} */ (request.body || {})
    // 手动拉取忽略 enabled 与当日幂等（立即拉取=测试/补拉；同日报 report/send 惯例）
    const result = await runPatrolEmailIngestion({ trigger: 'manual', force: body.force !== false })
    if (!result.ok && result.lastResult !== 'no_email') {
      return reply.code(400).send({ error: result.lastError || '拉取失败', ...result })
    }
    return result
  })
}
