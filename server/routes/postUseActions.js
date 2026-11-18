import { requirePermission } from '../middleware.js'
import { hasPermission } from '../../src/domain/auth/permissions.js'
import { logAuditFromRequest } from '../audit.js'
import { loadManagedProductCatalog } from '../../src/storage/productCatalogStore.js'
import { storageRepository } from '../storageRepository.js'
import {
  addPostUseAction,
  listPostUseActionSources,
  listPostUseActions,
  migrateLegacyPostUseActionSources,
  removePostUseAction,
} from '../postUseActionService.js'

/**
 * 新建议措写入前从 DB 刷新服务端产品目录缓存（11-18，refreshProductCatalogForReminder 先例）。
 * addPostUseAction 新建路径要按目录把 owner 产品名解析成目录 key——UI 改目录只写 DB，
 * 服务端进程内缓存不随之刷新，不刷新会用旧目录把 key 解析错/解析不中。
 * 刷新失败降级用缓存，不阻塞写入本身。
 * @param {import('fastify').FastifyBaseLogger} [logger]
 */
async function refreshProductCatalogForPostUseAction(logger) {
  const adapter = {
    getMeta: (key) => storageRepository.getMeta(key),
    putMeta: (key, value) => storageRepository.putMeta(key, value),
  }
  try {
    await loadManagedProductCatalog(adapter)
  } catch (err) {
    logger?.warn?.(
      `[post-use-actions] 产品目录刷新失败，降级用缓存: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** @param {unknown} value */
function validOwnerType(value) { return value === 'trace' || value === 'visit' }

/** @param {import('fastify').FastifyRequest} request @param {import('fastify').FastifyReply} reply */
function requireEdit(request, reply) {
  if (!request.user) return reply.code(401).send({ error: '未登录' })
  if (!hasPermission(request.user.role, 'editRecord')) {
    return reply.code(403).send({ error: '无权限执行此操作' })
  }
  return null
}

/** @param {import('fastify').FastifyReply} reply @param {unknown} error */
function sendActionError(reply, error) {
  const message = error instanceof Error ? error.message : '举措操作失败'
  const inputError = /请选择|不存在|已结束|不能为空|不能超过|不能填写|必须填写|无效/.test(message)
  return reply.code(inputError ? 400 : 500).send({ error: inputError ? message : '举措操作失败，请稍后重试' })
}

/** @param {import('fastify').FastifyInstance} app */
export function registerPostUseActionRoutes(app) {
  migrateLegacyPostUseActionSources()
  app.get('/api/post-use-actions/linked/:actionId', { preHandler: requirePermission('view') }, async (request) => {
    const { actionId } = /** @type {{ actionId: string }} */ (request.params)
    return listPostUseActionSources(actionId)
  })

  app.get('/api/post-use-actions/:ownerType/:ownerId', { preHandler: requirePermission('view') }, async (request, reply) => {
    const { ownerType, ownerId } = /** @type {{ ownerType: string; ownerId: string }} */ (request.params)
    if (!validOwnerType(ownerType)) return reply.code(400).send({ error: '关联类型无效' })
    const items = listPostUseActions(ownerType, ownerId)
    return items ? { items, total: items.length } : reply.code(404).send({ error: '记录不存在' })
  })

  app.post('/api/post-use-actions/:ownerType/:ownerId', async (request, reply) => {
    if (requireEdit(request, reply)) return
    const { ownerType, ownerId } = /** @type {{ ownerType: string; ownerId: string }} */ (request.params)
    if (!validOwnerType(ownerType)) return reply.code(400).send({ error: '关联类型无效' })
    const body = /** @type {{ actionId?: string; newAction?: { content?: string; detail?: string; scheduleAt?: string } }} */ (request.body || {})
    if (Boolean(body.actionId) === Boolean(body.newAction)) {
      return reply.code(400).send({ error: '请选择已有举措或填写新举措' })
    }
    // 仅新建议措路径需要最新目录（库选路径不落库新行）；刷新放在校验后避免无效请求白刷。
    if (body.newAction) await refreshProductCatalogForPostUseAction(request.log)
    try {
      const result = addPostUseAction(ownerType, ownerId, body, request.user)
      if (!result) return reply.code(404).send({ error: '记录不存在' })
      logAuditFromRequest(request, 'post_use_action.add', {
        ownerType, ownerId, actionId: result.action.id, created: Boolean(body.newAction),
      })
      return result
    } catch (error) { return sendActionError(reply, error) }
  })

  app.delete('/api/post-use-actions/:ownerType/:ownerId/:actionId', async (request, reply) => {
    if (requireEdit(request, reply)) return
    const { ownerType, ownerId, actionId } = /** @type {{ ownerType: string; ownerId: string; actionId: string }} */ (request.params)
    if (!validOwnerType(ownerType)) return reply.code(400).send({ error: '关联类型无效' })
    try {
      const item = removePostUseAction(ownerType, ownerId, actionId, request.user)
      if (!item) return reply.code(404).send({ error: '记录不存在' })
      logAuditFromRequest(request, 'post_use_action.remove', { ownerType, ownerId, actionId })
      return { item }
    } catch (error) { return sendActionError(reply, error) }
  })
}
