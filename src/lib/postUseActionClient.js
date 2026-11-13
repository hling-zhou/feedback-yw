import { apiFetch } from './apiClient.js'

/** @param {'trace'|'visit'} ownerType @param {string} ownerId */
function ownerUrl(ownerType, ownerId) {
  return `/api/post-use-actions/${ownerType}/${encodeURIComponent(ownerId)}`
}

/** @param {'trace'|'visit'} ownerType @param {string} ownerId */
export function listPostUseActions(ownerType, ownerId) {
  return apiFetch(ownerUrl(ownerType, ownerId))
}

/**
 * @param {'trace'|'visit'} ownerType
 * @param {string} ownerId
 * @param {{ actionId?: string; newAction?: { content: string; detail?: string; scheduleAt?: string } }} input
 */
export function addPostUseAction(ownerType, ownerId, input) {
  return apiFetch(ownerUrl(ownerType, ownerId), {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** @param {'trace'|'visit'} ownerType @param {string} ownerId @param {string} actionId */
export function removePostUseAction(ownerType, ownerId, actionId) {
  return apiFetch(`${ownerUrl(ownerType, ownerId)}/${encodeURIComponent(actionId)}`, {
    method: 'DELETE',
  })
}

/** @param {string} actionId */
export function listPostUseActionSources(actionId) {
  return apiFetch(`/api/post-use-actions/linked/${encodeURIComponent(actionId)}`)
}
