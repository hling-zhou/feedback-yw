import { hasPermission } from '../../src/domain/auth/permissions.js'
import { buildReportIssueOccurrences, isExplicitNoProblemVisit, reportCustomerMatches, reportProductName, traceSourceFingerprint, visitSourceFingerprint } from '../../src/lib/postUseRating/reportEvidence.js'
import { META_KEY_POST_USE_VISITS, normalizeVisitRecords } from '../../src/lib/postUseRating/visitRecords.js'
import { logAuditFromRequest } from '../audit.js'
import { requirePermission } from '../middleware.js'
import { postUseJiraRepository } from '../postUseJiraRepository.js'
import { postUseReportRepository } from '../postUseReportRepository.js'
import { storageRepository } from '../storageRepository.js'

const REPORT_KEY_RE = /^\d{4}-(?:0[1-9]|1[0-2]|Q[1-4])$/

function canEdit(request, reply) {
  if (request.user && hasPermission(request.user.role, 'editRecord')) return true
  reply.code(request.user ? 403 : 401).send({ error: '无权限执行此操作' })
  return false
}

function sourceRecord(sourceType, sourceId) {
  if (sourceType === 'trace') return postUseJiraRepository.getById(sourceId)
  if (sourceType === 'visit') {
    const visits = normalizeVisitRecords(storageRepository.getMeta(META_KEY_POST_USE_VISITS))
    return visits.find((row) => String(row.id) === sourceId) || null
  }
  return null
}

function sourceMonths(source) {
  return String(source?.importMonth || source?.visitMonth || '')
    .split('、').map((month) => month.trim()).filter((month) => /^\d{4}-\d{2}$/.test(month))
}

function sourceIssues(source) {
  const records = sourceMonths(source).flatMap((month) => storageRepository.listRecords({
    dataSourceType: 'post_use_rating', importMonthFrom: month, importMonthTo: month,
  }).records)
  return buildReportIssueOccurrences(records.filter((record) => (
    reportProductName(record) === reportProductName(source)
    && reportCustomerMatches(record, source)
  )))
}

/** @param {import('fastify').FastifyInstance} app */
export function registerPostUseReportRoutes(app) {
  app.get('/api/post-use-report/links', { preHandler: requirePermission('view') }, async () => ({
    items: postUseReportRepository.listLinks(),
  }))

  app.get('/api/post-use-report/source-issues', { preHandler: requirePermission('view') }, async (request, reply) => {
    const sourceType = String(request.query?.sourceType || '')
    const sourceId = String(request.query?.sourceId || '')
    const source = sourceRecord(sourceType, sourceId)
    if (!source) return reply.code(404).send({ error: '来源记录不存在' })
    const fingerprint = sourceType === 'visit' ? visitSourceFingerprint(source) : traceSourceFingerprint(source)
    return {
      items: sourceIssues(source).map((issue) => ({
        id: issue.id, recordId: issue.recordId, productName: issue.productName,
        customerName: issue.customerName, month: issue.month, issueName: issue.issueName,
        text: issue.text, score: issue.score,
      })),
      links: postUseReportRepository.listLinksForSource(sourceType, sourceId)
        .filter((link) => link.sourceFingerprint === fingerprint),
      noProblemEligible: sourceType === 'visit' && isExplicitNoProblemVisit(source),
    }
  })

  app.put('/api/post-use-report/links', async (request, reply) => {
    if (!canEdit(request, reply)) return
    const { issueId, sourceType, sourceId, verdict } = request.body || {}
    if (typeof issueId !== 'string' || issueId.length > 5000
      || !['visit', 'trace'].includes(sourceType)
      || typeof sourceId !== 'string' || !sourceId || sourceId.length > 200
      || !['related', 'no_issue'].includes(verdict)) {
      return reply.code(400).send({ error: '关联参数无效' })
    }
    const source = sourceRecord(sourceType, sourceId)
    if (!source) return reply.code(404).send({ error: '来源记录不存在' })
    if (verdict === 'no_issue' && (sourceType !== 'visit' || !isExplicitNoProblemVisit(source))) {
      return reply.code(400).send({ error: '仅明确记录无问题的省代表回访可排除具体问题' })
    }
    if (!sourceIssues(source).some((issue) => issue.id === issueId)) {
      return reply.code(400).send({ error: '该问题与来源的客户、产品或月份不一致' })
    }
    const sourceFingerprint = sourceType === 'visit' ? visitSourceFingerprint(source) : traceSourceFingerprint(source)
    const item = postUseReportRepository.saveLink({
      issueId, sourceType, sourceId, sourceFingerprint, verdict,
      updatedBy: request.user?.username || '',
    })
    logAuditFromRequest(request, 'post_use_report.issue_link', { issueId, sourceType, sourceId, verdict })
    return { item }
  })

  app.delete('/api/post-use-report/links', async (request, reply) => {
    if (!canEdit(request, reply)) return
    const { issueId, sourceType, sourceId } = request.body || {}
    if (!issueId || !['visit', 'trace'].includes(sourceType) || !sourceId) {
      return reply.code(400).send({ error: '关联参数无效' })
    }
    const removed = postUseReportRepository.deleteLink(issueId, sourceType, sourceId)
    if (removed) logAuditFromRequest(request, 'post_use_report.issue_unlink', { issueId, sourceType, sourceId })
    return { removed }
  })

  app.get('/api/post-use-report/drafts', { preHandler: requirePermission('view') }, async (request, reply) => {
    const reportKey = String(request.query?.reportKey || '')
    if (!REPORT_KEY_RE.test(reportKey)) return reply.code(400).send({ error: '报告周期无效' })
    return { items: postUseReportRepository.listDrafts(reportKey) }
  })

  app.put('/api/post-use-report/drafts', async (request, reply) => {
    if (!canEdit(request, reply)) return
    const { reportKey, productName, fingerprint, detail, action, conclusion } = request.body || {}
    if (!REPORT_KEY_RE.test(String(reportKey || '')) || typeof productName !== 'string' || !productName || productName.length > 200
      || typeof fingerprint !== 'string' || fingerprint.length > 10000
      || [detail, action, conclusion].some((value) => typeof value !== 'string' || value.length > 12000)) {
      return reply.code(400).send({ error: '文字稿参数无效' })
    }
    const item = postUseReportRepository.saveDraft(reportKey, productName, fingerprint, { detail, action, conclusion })
    logAuditFromRequest(request, 'post_use_report.draft_generate', { reportKey, productName })
    return { item }
  })
}
