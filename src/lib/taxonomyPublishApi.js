import { apiFetch } from './apiClient.js'

/**
 * @returns {Promise<{
 *   configured: boolean
 *   dir: string
 *   excelPath: string
 *   excelFile: string
 *   exists: boolean
 *   lastPublish: { lastPublishedAt?: string; lastPublishedBy?: string; excelPath?: string } | null
 * }>}
 */
export async function fetchTaxonomyPublishStatus() {
  return apiFetch('/api/storage/taxonomy/publish-status')
}

/**
 * @param {{ writeJson?: boolean }} [options]
 */
export async function publishTaxonomyToServer(options = {}) {
  return apiFetch('/api/storage/taxonomy/publish', {
    method: 'POST',
    body: JSON.stringify({
      writeJson: options.writeJson !== false,
    }),
  })
}
