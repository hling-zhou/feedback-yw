import { getDb } from './db.js'
import { actionItemRepository } from './actionItemRepository.js'
import { postUseJiraRepository } from './postUseJiraRepository.js'
import { storageRepository } from './storageRepository.js'
import { META_KEY_POST_USE_VISITS } from '../src/lib/postUseRating/visitRecords.js'
import { isActionItemLocked, validateActionItemCreate } from '../src/domain/actionItem.js'
import { normalizePostUseActionIds, withPostUseActionIds } from '../src/domain/postUseActions.js'

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
      const validated = validateActionItemCreate({
        productKey: productName,
        productName,
        source: 'post_use',
        content: input.newAction.content,
        detail: input.newAction.detail,
        scheduleAt: input.newAction.scheduleAt,
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
