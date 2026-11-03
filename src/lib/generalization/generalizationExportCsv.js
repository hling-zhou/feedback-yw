import {
  GENERALIZATION_CATEGORY_LABELS,
  GENERALIZATION_SCOPE_LABELS,
} from '../../domain/generalizationIssue.js'
import { formatGeneralizationCategoryLabel } from '../../domain/generalizationIssue.js'

/**
 * 举一反三问题清单 CSV 导出（G3-1，DESIGN §5.2 / TASKS G3-1）：纯 builder，客户端生成。
 *
 * 格式约定（照 observationExportCsv）：\ufeff BOM 保 Excel 中文；RFC 4180 转义
 * （含逗号/引号/换行的字段加引号并双写引号）；证据明细列 = ticketId + 摘要拼接；行数 cap 5000。
 *
 * 与留观导出的差异（v3.4）：新增 范畴 / 共性范围 / 根因分析（全文）/ 优化方案（全文）/ 来源举措 列；
 * 状态三态 in_progress/completed/terminated。范畴/共性导出中文标签（对齐状态列本地化口径）。
 */

const CSV_ROW_CAP = 5000

/** @param {string} field */
function csvEscape(field) {
  const text = String(field ?? '')
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/**
 * @param {unknown[]} fields
 */
function csvRow(fields) {
  return fields.map(csvEscape).join(',')
}

const HEADERS = [
  '产品',
  '问题标题',
  '问题描述',
  '范畴',
  '共性范围',
  '根因分析',
  '优化方案',
  '状态',
  '出现次数',
  '工单证据数',
  '首次出现',
  '最近出现',
  '关键词',
  '备注',
  '来源举措ID',
  '证据明细',
]

/**
 * 构建清单 CSV 文本。
 *
 * @param {Object} params
 * @param {Array<Record<string, unknown>>} params.issues - listGeneralizationIssues 返回的 issues
 * @param {{ issueId: string, links: Array<Record<string, unknown>>, actionRefs?: Array<Record<string, unknown>> }[]} [params.linksByIssue] - 证据明细 + 来源举措（可选；缺省时证据列为空）
 * @returns {{ csv: string, rowCount: number, truncated: boolean }}
 */
export function buildGeneralizationIssuesCsv({ issues, linksByIssue = [] }) {
  const linksMap = new Map(linksByIssue.map((entry) => [entry.issueId, entry.links || []]))
  const refsMap = new Map(linksByIssue.map((entry) => [entry.issueId, entry.actionRefs || []]))
  const rows = (issues || []).slice(0, CSV_ROW_CAP)
  const lines = [csvRow(HEADERS)]
  for (const issue of rows) {
    const links = linksMap.get(String(issue.id)) || []
    const actionRefs = refsMap.get(String(issue.id)) || []
    /** @type {{ keywords?: string[], notes?: string, promotedTo?: { actionItemId?: string }, categoryOther?: string }} */
    const payload = (issue.payload && typeof issue.payload === 'object'
      ? /** @type {any} */ (issue.payload)
      : {})
    const evidenceDetail = links
      .filter((l) => l.linkStatus === 'confirmed')
      .map((l) => {
        const label = l.ticketId || `记录${String(l.recordId).slice(0, 8)}`
        const excerpt = String(l.matchedExcerpt || '').slice(0, 40)
        return excerpt ? `${label}：${excerpt}` : label
      })
      .join('；')
    // 来源举措：origin_action_id（首个创建举措）优先，中间表 actionRefs 全量并列
    const originId = String(issue.originActionId || '')
    const refIds = actionRefs.map((r) => String(r.actionItemId || '')).filter(Boolean)
    const sourceActions = [originId, ...refIds]
      .filter((v, i, arr) => v && arr.indexOf(v) === i)
      .join('、')
    lines.push(
      csvRow([
        issue.productName,
        issue.title,
        issue.summary,
        // 11-04：「其他」带自定义说明拼「其他：xxx」
        formatGeneralizationCategoryLabel(
          /** @type {string} */ (issue.category),
          payload.categoryOther,
        ),
        GENERALIZATION_SCOPE_LABELS[/** @type {string} */ (issue.scope)] || issue.scope,
        issue.rootCause, // 根因分析：全文导出不截断（v3.4）
        issue.optimization, // 优化方案：全文导出不截断（v3.4）
        statusLabel(issue.status),
        String(issue.occurrenceCount ?? 0),
        String(issue.ticketCount ?? 0),
        String(issue.firstSeenAt || '').slice(0, 10),
        String(issue.lastSeenAt || '').slice(0, 10),
        (payload.keywords || []).join('、'),
        payload.notes || '',
        sourceActions,
        evidenceDetail,
      ]),
    )
  }
  return {
    csv: '\ufeff' + lines.join('\r\n'),
    rowCount: rows.length,
    truncated: (issues || []).length > CSV_ROW_CAP,
  }
}

/** @param {unknown} status */
function statusLabel(status) {
  const s = String(status || '')
  if (s === 'in_progress') return '进行中'
  if (s === 'completed') return '已完成'
  if (s === 'terminated') return '未完成终止'
  return s
}

/**
 * 触发浏览器下载。
 * @param {string} csv
 * @param {string} filename
 */
export function downloadGeneralizationCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
