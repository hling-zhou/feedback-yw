import { POST_USE_REASON_RULE_VERSION } from './modelVersions.js'

/** @param {unknown} value */
export function normalizeEvidenceText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Evidence keeps the source wording immutable while exposing normalized text for analysis.
 * @param {object} row
 * @param {{ recordId: string; importMonth: string; importBatchId: string }} meta
 */
export function buildPostUseEvidence(row, meta) {
  const sourceText = normalizeEvidenceText(row.rawComment || row.lowScoreReason)
  return {
    id: `evidence:${meta.recordId}`,
    recordId: meta.recordId,
    importMonth: meta.importMonth,
    importBatchId: meta.importBatchId,
    channel: row.channel,
    productName: normalizeEvidenceText(row.productName),
    customerName: normalizeEvidenceText(row.customerName),
    customerCode: normalizeEvidenceText(row.customerCode),
    score: Number.isFinite(row.score) ? row.score : null,
    originalScene: normalizeEvidenceText(row.scene) || '未提供',
    sourceText,
    normalizedText: sourceText.toLowerCase(),
    ruleVersion: POST_USE_REASON_RULE_VERSION,
  }
}
