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
        text: issue.text, score: issue.score, kind: issue.kind,
      })),
      links: postUseReportRepository.listLinksForSource(sourceType, sourceId)
        .filter((link) => link.sourceFingerprint === fingerprint),
      noProblemEligible: sourceType === 'visit' && isExplicitNoProblemVisit(source),
    }
  })

  app.put('/api/post-use-report/links', async (request, reply) => {
    if (!canEdit(request, reply)) return
    const { issueId, sourceType, sourceId, verdict } = request.body || {}
    // 11-23 拍板四值域（午后文案统一）：related（问题存在）/ no_dissatisfaction（无实际不满，仅回访）/
    // no_action（产品部评估无需优改——溯源结论或回访内部评估皆可）；no_issue 为存量兼容值（读取层已映射）
    if (typeof issueId !== 'string' || issueId.length > 5000
      || !['visit', 'trace'].includes(sourceType)
      || typeof sourceId !== 'string' || !sourceId || sourceId.length > 200
      || !['related', 'no_issue', 'no_dissatisfaction', 'no_action'].includes(verdict)) {
      return reply.code(400).send({ error: '关联参数无效' })
    }
    const source = sourceRecord(sourceType, sourceId)
    if (!source) return reply.code(404).send({ error: '来源记录不存在' })
    // 档位门槛（11-23 语义细分）：no_dissatisfaction 表"客户根本没不满"——语义上只有
    // 省代表回访结果能承载；no_action 表"核实后问题不成立/无需优改"——溯源结论与回访内部评估皆可。
    // 旧 no_issue 仅回访且正则命中才可选（历史口径），维持原门槛兼容。
    if (verdict === 'no_issue' && (sourceType !== 'visit' || !isExplicitNoProblemVisit(source))) {
      return reply.code(400).send({ error: '仅明确记录无问题的省代表回访可排除具体问题' })
    }
    if (verdict === 'no_dissatisfaction' && sourceType !== 'visit') {
      return reply.code(400).send({ error: '「无实际不满」仅适用于省代表回访记录' })
    }
    if (!sourceIssues(source).some((issue) => issue.id === issueId)) {
      return reply.code(400).send({ error: '该问题与来源的客户、产品或月份不一致' })
    }
    const sourceFingerprint = sourceType === 'visit' ? visitSourceFingerprint(source) : traceSourceFingerprint(source)
    const item = postUseReportRepository.saveLink({
      issueId, sourceType, sourceId, sourceFingerprint, verdict,
      verdictSource: 'manual', updatedBy: request.user?.username || '',
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

  // 11-23 拍板：关联具体问题 LLM 语义自动判定——单条来源记录的全部候选问题一次判定并写 link
  //（verdictSource='llm'；uncertain 不写留人工）。判定语义：related（问题存在）/
  // no_dissatisfaction（无实际不满，仅回访）/ no_action（产品部评估无需优改——溯源结论或回访内部评估）。
  // LLM 判 no_dissatisfaction 时绕过旧正则硬门槛（语义层放宽，报告消费按既有档位机制走）。
  app.post('/api/post-use-report/links/auto', async (request, reply) => {
    if (!canEdit(request, reply)) return
    const { sourceType, sourceId, settings } = request.body || {}
    if (!['visit', 'trace'].includes(sourceType) || typeof sourceId !== 'string' || !sourceId || sourceId.length > 200) {
      return reply.code(400).send({ error: '关联判定参数无效' })
    }
    // 11-23 共享判定入口（issueLinkAutoJudge）：抽屉按钮 / 导入尾部 / 保存尾部三触发点单源；
    // 人工修正保护（verdictSource='manual' 不覆盖）在共享层统一实施。
    const { autoJudgeIssueLinks } = await import('../issueLinkAutoJudge.js')
    const result = await autoJudgeIssueLinks({
      sourceType, sourceId, settings: settings || {},
      updatedBy: request.user?.username || '',
    })
    if (result.error) return reply.code(404).send({ error: result.error })
    logAuditFromRequest(request, 'post_use_report.issue_link_auto', {
      sourceType, sourceId, judged: result.judged, saved: result.saved, skippedManual: result.skippedManual,
    })
    return {
      saved: result.saved,
      skippedManual: result.skippedManual,
      judged: result.judged,
      message: result.saved
        ? `LLM 判定完成：${result.saved} 个候选已给出结论${result.skippedManual ? `（${result.skippedManual} 个人工判定不覆盖）` : ''}`
        : result.judged
          ? `LLM 已判定 ${result.judged} 个候选，但均为不确定或无需写入——留待人工确认`
          : '无可判定的候选问题（该来源记录无关联的低分反馈问题）',
    }
  })
}
