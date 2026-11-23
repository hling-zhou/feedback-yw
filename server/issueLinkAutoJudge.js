// 11-23 修复：本文件在 server/ 根——server 内依赖是同级 ./ 而非上级 ../
//（初版误抄 routes/ 目录的 import 深度，部署环境 Cannot find module 实锤，本地同型复现）
import { postUseReportRepository } from './postUseReportRepository.js'
import { storageRepository } from './storageRepository.js'
import { META_KEY_POST_USE_VISITS, normalizeVisitRecords } from '../src/lib/postUseRating/visitRecords.js'
import { buildReportIssueOccurrences, reportProductName, reportCustomerMatches, traceSourceFingerprint, visitSourceFingerprint } from '../src/lib/postUseRating/reportEvidence.js'
import { postUseJiraRepository } from './postUseJiraRepository.js'
import { setLlmTransport, resolveSettingsForLlm } from '../src/lib/llmClient.js'
import { forwardLlmChatCompletion } from './llmProxy.js'
import { buildInProcessLlmForwardArgs } from './enrichRunner.js'
import { isLlmConfigured } from './llmConfig.js'
import { generateIssueLinkVerdicts } from '../src/lib/postUseRating/issueLinkVerdict.js'

/**
 * 11-23 拍板：「关联具体问题」LLM 自动判定的共享入口——三个触发点单源复用：
 * ① 抽屉「LLM 自动判定」按钮（POST /api/post-use-report/links/auto）；
 * ② 数据导入完成时（用后即评导入链尾部，批量跑当月新记录）；
 * ③ 抽屉保存时（visit/trace 保存路由尾部，单条刷新）。
 *
 * 人工修正保护：verdictSource='manual' 的 link 一律跳过——LLM 不覆盖人工判定。
 * uncertain 不写 link（留人工）。失败静默返回 skipped（不阻塞导入/保存主流程）。
 */

/** @returns {Promise<Record<string, unknown> | null>} */
export function sourceRecordByType(sourceType, sourceId) {
  if (sourceType === 'trace') return postUseJiraRepository.getById(sourceId)
  if (sourceType === 'visit') {
    const visits = normalizeVisitRecords(storageRepository.getMeta(META_KEY_POST_USE_VISITS))
    return visits.find((row) => String(row.id) === sourceId) || null
  }
  return null
}

function sourceMonthsOf(source) {
  return String(source?.importMonth || source?.visitMonth || '')
    .split('、').map((m) => m.trim()).filter((m) => /^\d{4}-\d{2}$/.test(m))
}

function sourceIssuesOf(source) {
  const records = sourceMonthsOf(source).flatMap((month) => storageRepository.listRecords({
    dataSourceType: 'post_use_rating', importMonthFrom: month, importMonthTo: month,
  }).records)
  return buildReportIssueOccurrences(records.filter((record) => (
    reportProductName(record) === reportProductName(source)
    && reportCustomerMatches(record, source)
  )))
}

/**
 * 单条来源记录的 LLM 判定 + 写库（人工保护 + uncertain 跳过）。
 * @param {{ sourceType: 'visit' | 'trace', sourceId: string, settings?: object, updatedBy?: string }} input
 * @returns {Promise<{ judged: number, saved: number, skippedManual: number, error?: string }>}
 */
export async function autoJudgeIssueLinks({ sourceType, sourceId, settings, updatedBy = '' }) {
  const source = sourceRecordByType(sourceType, sourceId)
  if (!source) return { judged: 0, saved: 0, skippedManual: 0, error: '来源记录不存在' }
  const issues = sourceIssuesOf(source)
  if (!issues.length) return { judged: 0, saved: 0, skippedManual: 0 }

  // 人工修正保护：已 manual 的判定不覆盖（前端可见，LLM 只补空缺/改 llm 态）
  const existing = new Map(postUseReportRepository.listLinksForSource(sourceType, sourceId)
    .map((row) => [row.issueId, row]))

  const serverConfigured = isLlmConfigured()
  setLlmTransport(async (body) => forwardLlmChatCompletion(buildInProcessLlmForwardArgs(body)), {
    ...(settings || {}), llmServerConfigured: serverConfigured,
  })
  let result
  try {
    const resolved = await resolveSettingsForLlm(settings || {})
    result = await generateIssueLinkVerdicts(resolved, {
      sourceType,
      sourceResult: sourceType === 'visit'
        ? String(source.visitResult || source.visitFeedbackDetail || '')
        : String(source.recommendedReason || source.progress || source.customerFeedback || ''),
      sourceConclusion: sourceType === 'visit'
        ? String(source.internalConclusion || source.internalEvaluationDetail || '')
        : String(source.progress || source.recommendedReason || ''),
    }, issues.map((issue) => ({
      id: issue.id, issueName: issue.issueName, text: issue.text, score: issue.score, month: issue.month,
    })))
  } finally {
    setLlmTransport(null, null)
  }

  const sourceFingerprint = sourceType === 'visit' ? visitSourceFingerprint(source) : traceSourceFingerprint(source)
  let saved = 0
  let skippedManual = 0
  for (const row of result.verdicts) {
    if (row.verdict === 'uncertain' || !row.verdict) continue
    if (row.verdict === 'no_dissatisfaction' && sourceType !== 'visit') continue
    const prev = existing.get(row.issue.id)
    if (prev && prev.verdictSource === 'manual') { skippedManual += 1; continue }
    postUseReportRepository.saveLink({
      issueId: row.issue.id, sourceType, sourceId, sourceFingerprint,
      verdict: row.verdict, verdictSource: 'llm', updatedBy,
    })
    saved += 1
  }
  return { judged: result.verdicts.length, saved, skippedManual }
}
