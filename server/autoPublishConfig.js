import { isAutoPublishConfigEnabled } from './config.js'
import { logAudit } from './audit.js'
import { publishProductCatalogToFiles } from './productCatalogPublish.js'
import { publishTaxonomyToFiles } from './taxonomyPublish.js'
import { storageRepository } from './storageRepository.js'

const DEBOUNCE_MS = Number(process.env.AUTO_PUBLISH_DEBOUNCE_MS) || 4000

/** @type {ReturnType<typeof setTimeout> | null} */
let taxonomyTimer = null
/** @type {ReturnType<typeof setTimeout> | null} */
let catalogTimer = null
/** @type {string | undefined} */
let pendingTaxonomyBy = undefined
/** @type {string | undefined} */
let pendingCatalogBy = undefined

/**
 * @param {'taxonomy_managed' | 'product_catalog_managed_v1'} kind
 * @param {unknown} err
 */
function recordPublishError(kind, err) {
  const message = err instanceof Error ? err.message : String(err)
  const key =
    kind === 'taxonomy_managed' ? 'taxonomy_publish_error' : 'product_catalog_publish_error'
  storageRepository.putMeta(key, {
    at: new Date().toISOString(),
    message,
  })
}

/**
 * @param {'taxonomy_managed' | 'product_catalog_managed_v1'} kind
 */
function clearPublishError(kind) {
  const key =
    kind === 'taxonomy_managed' ? 'taxonomy_publish_error' : 'product_catalog_publish_error'
  storageRepository.putMeta(key, null)
}

/**
 * @param {'taxonomy' | 'product_catalog'} target
 * @param {string} [publishedBy]
 */
export function runConfigPublishNow(target, publishedBy = 'auto') {
  if (target === 'taxonomy') {
    const result = publishTaxonomyToFiles({ writeJson: true, publishedBy })
    clearPublishError('taxonomy_managed')
    return result
  }
  const result = publishProductCatalogToFiles({ writeJson: true, publishedBy })
  clearPublishError('product_catalog_managed_v1')
  return result
}

async function flushTaxonomyPublish() {
  taxonomyTimer = null
  const by = pendingTaxonomyBy || 'auto'
  pendingTaxonomyBy = undefined
  try {
    const result = runConfigPublishNow('taxonomy', by)
    logAudit({
      action: 'storage.auto_publish_taxonomy',
      username: by,
      detail: { excelPath: result.excelPath },
    })
  } catch (err) {
    recordPublishError('taxonomy_managed', err)
    console.warn('[auto-publish] taxonomy failed:', err)
  }
}

async function flushCatalogPublish() {
  catalogTimer = null
  const by = pendingCatalogBy || 'auto'
  pendingCatalogBy = undefined
  try {
    const result = runConfigPublishNow('product_catalog', by)
    logAudit({
      action: 'storage.auto_publish_product_catalog',
      username: by,
      detail: { excelPath: result.excelPath },
    })
  } catch (err) {
    recordPublishError('product_catalog_managed_v1', err)
    console.warn('[auto-publish] product catalog failed:', err)
  }
}

/**
 * @param {'taxonomy_managed' | 'product_catalog_managed_v1'} metaKey
 * @param {string} [username]
 */
export function scheduleConfigAutoPublish(metaKey, username) {
  if (!isAutoPublishConfigEnabled()) return

  if (metaKey === 'taxonomy_managed') {
    pendingTaxonomyBy = username || pendingTaxonomyBy || 'auto'
    if (taxonomyTimer) clearTimeout(taxonomyTimer)
    taxonomyTimer = setTimeout(() => {
      flushTaxonomyPublish().catch((err) => console.warn('[auto-publish]', err))
    }, DEBOUNCE_MS)
    return
  }

  if (metaKey === 'product_catalog_managed_v1') {
    pendingCatalogBy = username || pendingCatalogBy || 'auto'
    if (catalogTimer) clearTimeout(catalogTimer)
    catalogTimer = setTimeout(() => {
      flushCatalogPublish().catch((err) => console.warn('[auto-publish]', err))
    }, DEBOUNCE_MS)
  }
}
