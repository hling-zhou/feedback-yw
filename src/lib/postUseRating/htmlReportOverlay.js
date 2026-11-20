// 11-20 拍板 V1 彻底下线：v1 store 键（post_use_html_reports_v1）读写分支删除；
// META_KEY_POST_USE_HTML_REPORTS_V2 是 V2 早期 store 形态的存量键，直键 miss 后回退读取保留。
export const META_KEY_POST_USE_HTML_REPORTS_V2 = 'post_use_html_reports_v2'
export const META_KEY_POST_USE_HTML_REPORT_V2_PREFIX = 'post_use_html_report_v2_'

/**
 * @typedef {{
 *   month: string
 *   updatedAt: string
 *   updatedBy: string
 *   dataFingerprint: string
 *   hiddenSectionIds: string[]
 *   printAppendix: boolean
 *   snapshot?: Record<string, unknown> | null
 *   narratives: {
 *     judgment: string
 *     issues: Record<string, { conclusion: string, action: string }>
 *     todoNote: string
 *     todoItems?: { id: string, content: string, owner: string, team: string, source: 'manual' | 'auto' }[]
 *     actionOverrides?: Record<string, { text?: string, title?: string, detail?: string, actionType?: string, owner?: string, team?: string }>
 *     visitSupplements?: Record<string, { visitResult: string, internalConclusion: string, remark: string }>
 *     themeGroupLabels?: Record<string, string>
 *     themeL2Labels?: Record<string, string>
 *     evidenceVerdicts?: Record<string, string>
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

function normalizeSnapshot(raw, month) {
  if (raw?.version !== 'v2' || raw.reportKey !== month) return null
  try {
    return JSON.parse(JSON.stringify(raw))
  } catch {
    return null
  }
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
  /** @type {{ id: string, content: string, owner: string, team: string, source: 'manual' | 'auto' }[]} */
  const todoItems = Array.isArray(narratives.todoItems)
    ? narratives.todoItems
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id || `todo-${Math.random().toString(36).slice(2, 10)}`),
        content: String(item.content || ''),
        owner: String(item.owner || ''),
        team: String(item.team || ''),
        productName: String(item.productName || ''),
        status: String(item.status || ''),
        source: item.source === 'auto' ? 'auto' : 'manual',
      }))
      .filter((item) => item.content)
    : []
  const supplementsRaw = narratives.visitSupplements && typeof narratives.visitSupplements === 'object'
    ? narratives.visitSupplements
    : {}
  /** @type {Record<string, { visitResult: string, internalConclusion: string, remark: string }>} */
  const visitSupplements = {}
  for (const [key, value] of Object.entries(supplementsRaw)) {
    if (!value || typeof value !== 'object') continue
    visitSupplements[key] = {
      visitResult: String(value.visitResult || ''),
      internalConclusion: String(value.internalConclusion || ''),
      remark: String(value.remark || ''),
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
    snapshot: normalizeSnapshot(raw.snapshot, month),
    narratives: {
      judgment: String(narratives.judgment || ''),
      issues,
      todoNote: String(narratives.todoNote || ''),
      todoItems,
      actionOverrides: narratives.actionOverrides && typeof narratives.actionOverrides === 'object'
        ? Object.fromEntries(Object.entries(narratives.actionOverrides).map(([key, value]) => [key,
          Object.fromEntries(['text', 'title', 'detail', 'actionType', 'owner', 'team']
            .filter((field) => Object.prototype.hasOwnProperty.call(value || {}, field))
            .map((field) => [field, String(value[field] ?? '')])),
        ]))
        : {},
      visitSupplements,
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
  const direct = await adapter.getMeta(`${META_KEY_POST_USE_HTML_REPORT_V2_PREFIX}${month}`)
  if (direct) return normalizeOverlay(direct, month)
  // V2 早期 store 形态存量回退（直键 miss 时读旧聚合 store）
  const store = normalizeStore(await adapter.getMeta(META_KEY_POST_USE_HTML_REPORTS_V2))
  return normalizeOverlay(store.reports[month], month)
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {Partial<HtmlReportOverlay> & {month: string}} overlay
 */
export async function saveHtmlReportOverlay(adapter, overlay) {
  if (!adapter?.putMeta) throw new Error('当前存储不支持保存月报叙述')
  const month = String(overlay?.month || '')
  if (!month) throw new Error('缺少报告月份')
  const nextOverlay = normalizeOverlay({
    ...overlay,
    updatedAt: overlay.updatedAt || new Date().toISOString(),
  }, month)
  // V1 下线后唯一写路径：V2 直键（不再写任何聚合 store）
  await adapter.putMeta(`${META_KEY_POST_USE_HTML_REPORT_V2_PREFIX}${month}`, nextOverlay)
  return nextOverlay
}
