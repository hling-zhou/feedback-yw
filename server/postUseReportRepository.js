import { getDb } from './db.js'

export const postUseReportRepository = {
  listLinks() {
    return getDb().prepare(`SELECT issue_id AS issueId, source_type AS sourceType,
      source_id AS sourceId, source_fingerprint AS sourceFingerprint, verdict,
      verdict_source AS verdictSource,
      updated_at AS updatedAt, updated_by AS updatedBy FROM post_use_report_issue_links`).all()
  },

  listLinksForSource(sourceType, sourceId) {
    return getDb().prepare(`SELECT issue_id AS issueId, source_type AS sourceType,
      source_id AS sourceId, source_fingerprint AS sourceFingerprint, verdict,
      verdict_source AS verdictSource,
      updated_at AS updatedAt, updated_by AS updatedBy FROM post_use_report_issue_links
      WHERE source_type = ? AND source_id = ?`).all(sourceType, sourceId)
  },

  /**
   * 11-23 拍板：verdict 四值（related/no_dissatisfaction/no_action，兼容存量 no_issue）
   * + verdictSource 来源标注（llm/manual——LLM 自动判定写入 'llm'，人工修正/手选写 'manual'）。
   */
  saveLink({ issueId, sourceType, sourceId, sourceFingerprint, verdict, verdictSource = 'manual', updatedBy }) {
    const updatedAt = new Date().toISOString()
    getDb().prepare(`INSERT INTO post_use_report_issue_links
      (issue_id, source_type, source_id, source_fingerprint, verdict, verdict_source, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id, source_type, source_id) DO UPDATE SET
        source_fingerprint = excluded.source_fingerprint, verdict = excluded.verdict,
        verdict_source = excluded.verdict_source,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(
      issueId, sourceType, sourceId, sourceFingerprint, verdict, verdictSource, updatedAt, updatedBy,
    )
    return { issueId, sourceType, sourceId, sourceFingerprint, verdict, verdictSource, updatedAt, updatedBy }
  },

  deleteLink(issueId, sourceType, sourceId) {
    return getDb().prepare(`DELETE FROM post_use_report_issue_links
      WHERE issue_id = ? AND source_type = ? AND source_id = ?`).run(issueId, sourceType, sourceId).changes > 0
  },

  listDrafts(reportKey) {
    return getDb().prepare(`SELECT product_name AS productName, fingerprint, payload, updated_at AS updatedAt
      FROM post_use_report_drafts WHERE report_key = ?`).all(reportKey).map((row) => ({
      productName: row.productName, fingerprint: row.fingerprint,
      ...JSON.parse(row.payload), updatedAt: row.updatedAt,
    }))
  },

  saveDraft(reportKey, productName, fingerprint, draft) {
    const updatedAt = new Date().toISOString()
    getDb().prepare(`INSERT INTO post_use_report_drafts
      (report_key, product_name, fingerprint, payload, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(report_key, product_name) DO UPDATE SET
        fingerprint = excluded.fingerprint, payload = excluded.payload, updated_at = excluded.updated_at`).run(
      reportKey, productName, fingerprint, JSON.stringify(draft), updatedAt,
    )
    return { productName, fingerprint, ...draft, updatedAt }
  },
}
