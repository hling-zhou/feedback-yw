import { apiFetch } from './apiClient.js'

/**
 * @typedef {import('../domain/requirementTicketProgress.js').RequirementTicketProgressRow} RequirementTicketProgressRow
 * @typedef {import('../domain/requirementTicketProgress.js').RequirementStatusMappingRow} RequirementStatusMappingRow
 */

/**
 * @param {string[]} ticketIds
 */
export async function lookupRequirementTickets(ticketIds) {
  const ids = [...new Set((ticketIds || []).map((id) => String(id).trim()).filter(Boolean))]
  if (!ids.length) return []
  const data = await apiFetch('/api/requirement-ticket-progress/lookup', {
    method: 'POST',
    body: JSON.stringify({ ticketIds: ids }),
  })
  return Array.isArray(data?.tickets)
    ? /** @type {import('../domain/requirementTicketProgress.js').RequirementTicketDetail[]} */ (
        data.tickets
      )
    : []
}

/**
 * @param {Record<string, string | number | undefined>} [query]
 */
export async function listRequirementTicketProgress(query = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue
    params.set(key, String(value))
  }
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const data = await apiFetch(`/api/requirement-ticket-progress${suffix}`)
  return {
    items: Array.isArray(data?.items) ? /** @type {RequirementTicketProgressRow[]} */ (data.items) : [],
    total: Number(data?.total) || 0,
    limit: Number(data?.limit) || 50,
    offset: Number(data?.offset) || 0,
  }
}

/**
 * @param {import('../../server/requirementTicketProgressRepository.js').RequirementTicketProgressImportRow[]} rows
 */
export async function importRequirementTicketProgress(rows) {
  return apiFetch('/api/requirement-ticket-progress/import', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  })
}

export async function listRequirementStatusMappings() {
  const data = await apiFetch('/api/requirement-status-mapping')
  return Array.isArray(data?.items) ? /** @type {RequirementStatusMappingRow[]} */ (data.items) : []
}

/**
 * @param {RequirementStatusMappingRow[]} items
 */
export async function saveRequirementStatusMappings(items) {
  return apiFetch('/api/requirement-status-mapping', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  })
}
