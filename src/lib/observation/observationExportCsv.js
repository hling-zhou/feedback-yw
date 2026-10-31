/**
 * 留观问题清单 CSV 导出（F4，DESIGN §5.2）：纯 builder，客户端生成。
 *
 * 格式约定：\ufeff BOM 保 Excel 中文；RFC 4180 转义（含逗号/引号/换行的字段加引号并双写引号）；
 * 证据明细列 = ticketId + 摘要拼接；行数 cap 5000。
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
 * @param {string[]} fields
 */
function csvRow(fields) {
  return fields.map(csvEscape).join(',')
}

const HEADERS = [
  '产品',
  '问题标题',
  '问题描述',
  '状态',
  '出现次数',
  '工单证据数',
  '评价证据数',
  '首次出现',
  '最近出现',
  '关键词',
  '备注',
  '已升级举措ID',
  '证据明细',
]

/**
 * 构建清单 CSV 文本。
 *
 * @param {Object} params
 * @param {Array<Record<string, unknown>>} params.issues - listObservationIssues 返回的 issues
 * @param {{ issueId: string, links: Array<Record<string, unknown>> }[]} [params.linksByIssue] - 证据明细（可选；缺省时证据列为空）
 * @param {string} [params.scopeLabel] - 导出范围标签（文件名用，不在 CSV 内）
 * @returns {{ csv: string, rowCount: number, truncated: boolean }}
 */
export function buildObservationIssuesCsv({ issues, linksByIssue = [] }) {
  const linksMap = new Map(linksByIssue.map((entry) => [entry.issueId, entry.links || []]))
  const rows = (issues || []).slice(0, CSV_ROW_CAP)
  const lines = [csvRow(HEADERS)]
  for (const issue of rows) {
    const links = linksMap.get(String(issue.id)) || []
    const evidenceDetail = links
      .filter((l) => l.linkStatus === 'confirmed')
      .map((l) => {
        const label = l.ticketId || `记录${String(l.recordId).slice(0, 8)}`
        const excerpt = String(l.matchedExcerpt || '').slice(0, 40)
        return excerpt ? `${label}：${excerpt}` : label
      })
      .join('；')
    const promotedTo = issue.payload?.promotedTo
    lines.push(
      csvRow([
        issue.productName,
        issue.title,
        issue.summary,
        statusLabel(issue.status),
        String(issue.occurrenceCount ?? 0),
        String(issue.ticketCount ?? 0),
        String(issue.ratingCount ?? 0),
        String(issue.firstSeenAt || '').slice(0, 10),
        String(issue.lastSeenAt || '').slice(0, 10),
        (issue.payload?.keywords || []).join('、'),
        issue.payload?.notes || '',
        promotedTo?.actionItemId || '',
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

/** @param {string} status */
function statusLabel(status) {
  if (status === 'watching') return '观察中'
  if (status === 'promoted') return '已升级'
  if (status === 'archived') return '已关闭'
  return status
}

/**
 * 触发浏览器下载。
 * @param {string} csv
 * @param {string} filename
 */
export function downloadObservationCsv(csv, filename) {
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
