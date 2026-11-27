import { getDb } from './db.js'
import { actionItemRepository } from './actionItemRepository.js'
import { postUseJiraRepository } from './postUseJiraRepository.js'
import { storageRepository } from './storageRepository.js'
import { META_KEY_POST_USE_VISITS } from '../src/lib/postUseRating/visitRecords.js'
import { isActionItemLocked, validateActionItemCreate } from '../src/domain/actionItem.js'
import { normalizePostUseActionIds, withPostUseActionIds } from '../src/domain/postUseActions.js'
import { getCatalogProducts } from '../src/lib/productCatalogLoader.js'
import { resolveCatalogProduct } from '../src/lib/productCatalog/resolveCatalogProduct.js'

/**
 * 用后即评 owner 的产品名 → 目录 key 解析（11-18 拍板：写入口径修正）。
 * 溯源/回访记录只有中文名（productName），历史实现把中文名直接塞进 productKey 通道，
 * 与举措库按目录 key 匹配的查询口径错位。此处按进程内目录缓存解析；
 * 路由层在写操作前已 loadManagedProductCatalog 刷新（refreshProductCatalogForReminder 先例）。
 * 未命中目录时保持旧形态（中文名原样返回），不阻断写入。
 * @param {string | undefined | null} productName
 * @returns {string}
 */
function resolvePostUseProductKeyFromCatalog(productName) {
  const raw = String(productName ?? '').trim()
  if (!raw) return ''
  const products = getCatalogProducts()
  const resolved = products.length ? resolveCatalogProduct({ productName: raw }, products) : null
  return resolved?.key?.trim() || raw
}

/** @param {string} id */
function getVisit(id) {
  const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
  const record = Array.isArray(raw?.records)
    ? raw.records.find((item) => String(item?.id || '') === id)
    : null
  return record ? withPostUseActionIds(record, normalizePostUseActionIds(record.actionIds, record.actionId)) : null
}

/** @param {'trace'|'visit'} ownerType @param {string} ownerId */
export function getPostUseActionOwner(ownerType, ownerId) {
  if (ownerType === 'trace') return postUseJiraRepository.getById(ownerId)
  if (ownerType === 'visit') return getVisit(ownerId)
  return null
}

/**
 * 每次从当前记录增量更新关联；空数组显式保留，重导不能从旧 actionId 回填。
 * @param {string} id
 * @param {string} actionId
 * @param {'add'|'remove'} operation
 * @param {{ id: string; username: string; displayName?: string }} actor
 */
function updateVisitActionLink(id, actionId, operation, actor) {
  const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
  const records = Array.isArray(raw?.records) ? raw.records : []
  const index = records.findIndex((item) => String(item?.id || '') === id)
  if (index < 0) return null
  const previous = records[index]
  const current = normalizePostUseActionIds(previous.actionIds, previous.actionId)
  const nextIds = operation === 'add'
    ? current.includes(actionId) ? current : [...current, actionId]
    : current.filter((value) => value !== actionId)
  if (nextIds.length === current.length) return withPostUseActionIds(previous, current)
  const editedAt = new Date().toISOString()
  const editor = {
    userId: actor.id,
    username: actor.username,
    displayName: actor.displayName || '',
    editedAt,
  }
  const updated = {
    ...withPostUseActionIds(previous, nextIds),
    updatedAt: editedAt,
    manualEditedFields: [...new Set([
      ...(Array.isArray(previous.manualEditedFields) ? previous.manualEditedFields : []),
      'actionIds', 'actionId',
    ])],
    fieldEditMeta: { ...(previous.fieldEditMeta || {}), actionIds: editor, actionId: editor },
  }
  const next = [...records]
  next[index] = updated
  storageRepository.putMeta(META_KEY_POST_USE_VISITS, {
    ...raw,
    updatedAt: editedAt,
    records: next,
  })
  return updated
}

/**
 * @param {'trace'|'visit'} ownerType
 * @param {string} ownerId
 * @param {string} actionId
 * @param {'add'|'remove'} operation
 * @param {{ id: string; username: string; displayName?: string }} actor
 */
function updateOwner(ownerType, ownerId, actionId, operation, actor) {
  return ownerType === 'trace'
    ? postUseJiraRepository.updateActionLink(ownerId, actionId, operation, actor)
    : updateVisitActionLink(ownerId, actionId, operation, actor)
}

/**
 * owner 记录的客户反馈（确立举措时作为问题快照来源；两实体字段名不同显式分支——
 * trace=post_use_jira_items.customerFeedback，visit=userFeedbackText，见 03 文档 §2 双字段口径：
 * visit/jira item 是独立领域实体，禁机械套 record 层字段名）。
 * @param {'trace'|'visit'} ownerType
 * @param {Record<string, unknown> | null} owner
 * @returns {string}
 */
function ownerFeedbackText(ownerType, owner) {
  if (!owner) return ''
  const raw = ownerType === 'trace' ? owner.customerFeedback : owner.userFeedbackText
  return String(raw ?? '').trim()
}

/**
 * @param {'trace'|'visit'} ownerType
 * @param {string} ownerId
 * @param {{ actionId?: string; newAction?: { content?: string; detail?: string; scheduleAt?: string } }} input
 * @param {{ id: string; username: string; displayName?: string }} actor
 */
export function addPostUseAction(ownerType, ownerId, input, actor) {
  return getDb().transaction(() => {
    const owner = getPostUseActionOwner(ownerType, ownerId)
    if (!owner) return null
    let action
    if (input.newAction) {
      const productName = String(owner.product || owner.productName || '').trim()
      // 11-18 写入口径修正：productKey 通道走目录 key（ productName 保持中文名），
      // 历史行为是把中文名塞进 product_key——与 /api/actions 按目录 key 的查询口径错位。
      // 问题快照（11-27）：客户反馈作为问题带过来（用户拍板；空反馈保持空，不造占位文案）。
      const validated = validateActionItemCreate({
        productKey: resolvePostUseProductKeyFromCatalog(productName),
        productName,
        source: 'post_use',
        content: input.newAction.content,
        detail: input.newAction.detail,
        scheduleAt: input.newAction.scheduleAt,
        painPointSnapshot: ownerFeedbackText(ownerType, owner),
      })
      if (!validated.ok) throw new Error(validated.error)
      action = actionItemRepository.putActionItem(validated.item, {
        actor: { userId: actor.id, username: actor.username },
      })
    } else {
      const id = String(input.actionId || '').trim()
      if (!id) throw new Error('请选择举措')
      action = actionItemRepository.getActionItem(id)
      if (!action) throw new Error('举措不存在')
      const alreadyLinked = normalizePostUseActionIds(owner.actionIds, owner.actionId).includes(id)
      if (action.source !== 'post_use' && !alreadyLinked) throw new Error('请选择用后即评举措')
      if (isActionItemLocked(action.status) && !alreadyLinked) {
        throw new Error('该举措已结束，无法新增关联')
      }
      // 问题快照补齐（11-27）：选库路径与新建路径语义同构（工单抽屉 buildSnapshotPatchOnTicketLink 先例）——
      // 举措尚无任何溯源/回访关联（首关联）且问题为空时，从本次 owner 的客户反馈补齐；已有值不覆盖。
      if (!alreadyLinked && !String(action.painPointSnapshot ?? '').trim()) {
        const feedback = ownerFeedbackText(ownerType, owner)
        const { traces: linkedTraces, visits: linkedVisits } = listPostUseActionSources(id)
        if (feedback && !linkedTraces.length && !linkedVisits.length) {
          action = actionItemRepository.putActionItem(
            { ...action, painPointSnapshot: feedback },
            { actor: { userId: actor.id, username: actor.username } },
          )
        }
      }
    }
    const item = updateOwner(ownerType, ownerId, action.id, 'add', actor)
    return { item, action }
  })()
}

/**
 * @param {'trace'|'visit'} ownerType
 * @param {string} ownerId
 * @param {string} actionId
 * @param {{ id: string; username: string; displayName?: string }} actor
 */
export function removePostUseAction(ownerType, ownerId, actionId, actor) {
  return getDb().transaction(() => {
    const owner = getPostUseActionOwner(ownerType, ownerId)
    if (!owner) return null
    return updateOwner(ownerType, ownerId, actionId, 'remove', actor)
  })()
}

/** @param {'trace'|'visit'} ownerType @param {string} ownerId */
export function listPostUseActions(ownerType, ownerId) {
  const owner = getPostUseActionOwner(ownerType, ownerId)
  if (!owner) return null
  const ids = normalizePostUseActionIds(owner.actionIds, owner.actionId)
  return ids.map((id) => actionItemRepository.getActionItem(id) || { id, missing: true })
}

/** @param {string} actionId */
export function listPostUseActionSources(actionId) {
  const traces = postUseJiraRepository.list({ actionId, limit: 0 }).items
  const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
  const visits = (Array.isArray(raw?.records) ? raw.records : [])
    .filter((record) => normalizePostUseActionIds(record.actionIds, record.actionId).includes(actionId))
    .map((record) => withPostUseActionIds(record, normalizePostUseActionIds(record.actionIds, record.actionId)))
  return { traces, visits }
}

/**
 * 举措删除时联动清理（2026-11-25）：把溯源/回访记录里指向该举措的
 * actionIds 引用全部摘除，防 listPostUseActions 出现 { id, missing: true } 悬挂。
 * @param {string} actionId
 * @param {{ id: string; username: string; displayName?: string }} actor
 * @returns {number} 清理的关联条数
 */
export function removeAllPostUseActionLinks(actionId, actor) {
  const id = String(actionId ?? '').trim()
  if (!id) return 0
  const { traces, visits } = listPostUseActionSources(id)
  let cleared = 0
  for (const trace of traces) {
    const next = updateOwner('trace', trace.id, id, 'remove', actor)
    // 返回记录的 actionIds 已不含该举措 = 真实清理；null = 记录已不存在
    if (next && !normalizePostUseActionIds(next.actionIds, next.actionId).includes(id)) cleared += 1
  }
  for (const visit of visits) {
    const next = updateOwner('visit', visit.id, id, 'remove', actor)
    if (next && !normalizePostUseActionIds(next.actionIds, next.actionId).includes(id)) cleared += 1
  }
  return cleared
}

/**
 * 旧版 validateActionItemCreate 曾丢失 source；把已关联用后即评且未关联工单的
 * 存量举措归回 post_use，使它们可继续在举措库选择器里被复用。
 */
export function migrateLegacyPostUseActionSources() {
  const db = getDb()
  const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
  const visits = Array.isArray(raw?.records) ? raw.records : []
  const traces = postUseJiraRepository.list({ limit: 0 }).items
  const ids = new Set([...traces, ...visits].flatMap((record) =>
    normalizePostUseActionIds(record.actionIds, record.actionId)))
  const read = db.prepare('SELECT source, payload FROM action_items WHERE id = ?')
  const update = db.prepare('UPDATE action_items SET source = ?, payload = ? WHERE id = ?')
  let migrated = 0
  db.transaction(() => {
    for (const id of ids) {
      const row = read.get(id)
      if (!row || row.source !== 'ticket') continue
      const item = JSON.parse(row.payload)
      if (item.source || item.linkedTicketIds?.length) continue
      update.run('post_use', JSON.stringify({ ...item, source: 'post_use' }), id)
      migrated += 1
    }
  })()
  return migrated
}
