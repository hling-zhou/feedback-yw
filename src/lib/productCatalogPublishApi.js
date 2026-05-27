import { apiFetch } from './apiClient.js'

/**
 * @returns {Promise<{
 *   configured: boolean
 *   dir: string
 *   excelPath: string
 *   jsonPath: string
 *   exists: boolean
 *   lastPublish: { lastPublishedAt?: string; lastPublishedBy?: string } | null
 * }>}
 */
export async function fetchProductCatalogPublishStatus() {
  return apiFetch('/api/storage/product-catalog/publish-status')
}

/**
 * @param {{ writeJson?: boolean }} [options]
 */
export async function publishProductCatalogToServer(options = {}) {
  return apiFetch('/api/storage/product-catalog/publish', {
    method: 'POST',
    body: JSON.stringify({
      writeJson: options.writeJson !== false,
    }),
  })
}
