import {
  DC_USER_JOURNEY,
  DC_PRODUCT_MATCH,
} from '../journeys/dcJourney.js'
import { normalizeRecordTaxonomyKeys } from '../taxonomyKeyAliases.js'

const LEGACY_DC_KEYS = new Set(['ecc', 'yunzx', 'yunzhuanxian'])

/** 实单校准版本；递增后 migrate 会覆盖托管库中的云专线旅程 */
export const DC_JOURNEY_CALIBRATION_VERSION = 1

/**
 * 将托管标签库中的云专线产品 key 从 ecc 等旧值迁移为 dc，并注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean} 是否有变更
 */
export function migrateDcProductKeyInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  for (const legacyKey of [...LEGACY_DC_KEYS]) {
    const legacy = snapshot.products[legacyKey]
    if (!legacy) continue

    if (!snapshot.products.dc) {
      snapshot.products.dc = {
        ...structuredClone(legacy),
        key: 'dc',
        name: legacy.name?.trim() || '云专线',
        match: [...new Set([...(legacy.match || []), ...DC_PRODUCT_MATCH])],
        journeys: structuredClone(DC_USER_JOURNEY),
        journeyConfigured: true,
        catalogProvisioned: false,
        journeyCalibrationVersion: DC_JOURNEY_CALIBRATION_VERSION,
      }
      changed = true
    }

    delete snapshot.products[legacyKey]
    changed = true
  }

  const dc = snapshot.products.dc
  if (dc) {
    const needsJourneys =
      !dc.journeyConfigured ||
      !(dc.journeys?.length) ||
      (dc.journeyCalibrationVersion || 0) < DC_JOURNEY_CALIBRATION_VERSION
    if (needsJourneys) {
      dc.journeys = structuredClone(DC_USER_JOURNEY)
      dc.journeyConfigured = true
      dc.catalogProvisioned = false
      dc.journeyCalibrationVersion = DC_JOURNEY_CALIBRATION_VERSION
      changed = true
    }
    const mergedMatch = [...new Set([...(dc.match || []), ...DC_PRODUCT_MATCH])]
    if (mergedMatch.length !== (dc.match || []).length) {
      dc.match = mergedMatch
      changed = true
    }
    if (!dc.name?.trim()) {
      dc.name = '云专线'
      changed = true
    }
  }

  return changed
}

/**
 * @param {import('../../storage/types.js').FeedbackRecord} record
 * @returns {boolean}
 */
export function migrateDcProductKeyOnRecord(record) {
  return normalizeRecordTaxonomyKeys(record)
}
