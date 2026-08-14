export const META_KEY_POST_USE_HTML_REPORTS = 'post_use_html_reports_v1'

/**
 * @typedef {{
 *   month: string
 *   updatedAt: string
 *   updatedBy: string
 *   dataFingerprint: string
 *   hiddenSectionIds: string[]
 *   printAppendix: boolean
 *   narratives: {
 *     judgment: string
 *     issues: Record<string, { conclusion: string, action: string }>
 *     todoNote: string
 *   }
 * }} HtmlReportOverlay
 */

function emptyStore() {
  return { version: 1, reports: {} }
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore()
  const reports = raw.reports && typeof raw.reports === 'object' ? raw.reports : {}
  return { version: 1, reports }
}

function normalizeOverlay(raw, month) {
  if (!raw || typeof raw !== 'object') return null
  const narratives = raw.narratives && typeof raw.narratives === 'object' ? raw.narratives : {}
  const issuesRaw = narratives.issues && typeof narratives.issues === 'object' ? narratives.issues : {}
  /** @type {Record<string, { conclusion: string, action: string }>} */
  const issues = {}
  for (const [key, value] of Object.entries(issuesRaw)) {
    if (!value || typeof value !== 'object') continue
    issues[key] = {
      conclusion: String(value.conclusion || ''),
      action: String(value.action || ''),
    }
  }
  return {
    month: String(raw.month || month || ''),
    updatedAt: String(raw.updatedAt || ''),
    updatedBy: String(raw.updatedBy || ''),
    dataFingerprint: String(raw.dataFingerprint || ''),
    hiddenSectionIds: Array.isArray(raw.hiddenSectionIds)
      ? raw.hiddenSectionIds.map((id) => String(id)).filter(Boolean)
      : [],
    printAppendix: Boolean(raw.printAppendix),
    narratives: {
      judgment: String(narratives.judgment || ''),
      issues,
      todoNote: String(narratives.todoNote || ''),
    },
  }
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown> }} adapter
 * @param {string} month
 * @returns {Promise<HtmlReportOverlay | null>}
 */
export async function loadHtmlReportOverlay(adapter, month) {
  if (!adapter?.getMeta || !month) return null
  const store = normalizeStore(await adapter.getMeta(META_KEY_POST_USE_HTML_REPORTS))
  return normalizeOverlay(store.reports[month], month)
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {HtmlReportOverlay} overlay
 */
export async function saveHtmlReportOverlay(adapter, overlay) {
  if (!adapter?.putMeta) throw new Error('当前存储不支持保存月报叙述')
  const month = String(overlay?.month || '')
  if (!month) throw new Error('缺少报告月份')
  const prev = normalizeStore(await adapter.getMeta?.(META_KEY_POST_USE_HTML_REPORTS))
  const nextOverlay = normalizeOverlay({
    ...overlay,
    updatedAt: overlay.updatedAt || new Date().toISOString(),
  }, month)
  await adapter.putMeta(META_KEY_POST_USE_HTML_REPORTS, {
    version: 1,
    updatedAt: nextOverlay.updatedAt,
    reports: {
      ...prev.reports,
      [month]: nextOverlay,
    },
  })
  return nextOverlay
}
