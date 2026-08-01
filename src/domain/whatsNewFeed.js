/**
 * 更新动态（Git changelog）领域：解析、标签、已读状态。
 */

/** @typedef {'feature' | 'fix' | 'improvement'} WhatsNewCategory */

/**
 * @typedef {Object} WhatsNewItem
 * @property {string} id
 * @property {string} title
 * @property {WhatsNewCategory} category
 * @property {string[]} modules
 * @property {string} publishedAt
 * @property {string | null} [appVersion]
 * @property {string} [summary]
 * @property {string | null} [commitUrl]
 * @property {'git'} [source]
 */

/**
 * @typedef {Object} WhatsNewFeed
 * @property {string} generatedAt
 * @property {'git'} source
 * @property {string} [since]
 * @property {string} [repoCommit]
 * @property {WhatsNewItem[]} items
 */

export const WHATS_NEW_FEED_LAST_SEEN_KEY = 'fi.whatsNewFeed.lastSeenAt'

/** @type {Record<WhatsNewCategory, string>} */
export const WHATS_NEW_CATEGORY_LABELS = {
  feature: '新功能',
  fix: '问题修复',
  improvement: '体验优化',
}

/** @type {Record<string, string>} */
export const WHATS_NEW_MODULE_LABELS = {
  workbench: '洞察工作台',
  feedbacks: '反馈库',
  actions: '举措与进展',
  import: '数据导入',
  tags: '分析维度',
  settings: '设置',
  other: '其他',
}

/** @type {Record<string, WhatsNewCategory>} */
export const CONVENTIONAL_TYPE_TO_CATEGORY = {
  feat: 'feature',
  fix: 'fix',
  perf: 'improvement',
  refactor: 'improvement',
}

/** Types included in the feed by default (excludes perf/refactor noise). */
export const WHATS_NEW_INCLUDED_TYPES = new Set(['feat', 'fix'])

/** @type {Record<string, string>} */
export const SCOPE_TO_MODULE = {
  workbench: 'workbench',
  insight: 'workbench',
  themes: 'workbench',
  feedbacks: 'feedbacks',
  feedback: 'feedbacks',
  drawer: 'feedbacks',
  actions: 'actions',
  action: 'actions',
  import: 'import',
  tags: 'tags',
  taxonomy: 'tags',
  catalog: 'tags',
  settings: 'settings',
  auth: 'settings',
  users: 'settings',
  'whats-new': 'other',
  whatsnew: 'other',
}

const SUBJECT_RE =
  /^(?<type>feat|fix|perf|refactor|chore|docs|test|ci|build|style|revert)(\((?<scope>[^)]+)\))?!?:\s*(?<title>.+)$/i

/** Git commit message trailer 行（位于 body 末尾） */
const COMMIT_TRAILER_RE =
  /^(?:[A-Za-z0-9][\w-]*|[A-Z][a-z]+(?:-[A-Z][a-z]+)+):\s+\S|^Signed-off-by:\s+/i

/**
 * @param {string} line
 */
export function isGitCommitTrailerLine(line) {
  const t = String(line ?? '').trim()
  if (!t) return false
  return COMMIT_TRAILER_RE.test(t)
}

/**
 * 保留完整 commit body，去掉末尾 Co-authored-by / Signed-off-by 等 trailer 块。
 * @param {string} [body]
 * @returns {string}
 */
export function formatCommitBodyAsSummary(body) {
  const raw = String(body ?? '').replace(/\r\n/g, '\n')
  if (!raw.trim()) return ''

  const lines = raw.split('\n')
  let end = lines.length - 1
  while (end >= 0 && lines[end].trim() === '') end -= 1
  if (end < 0) return ''

  let trailerStart = end + 1
  let i = end
  while (i >= 0 && isGitCommitTrailerLine(lines[i])) {
    trailerStart = i
    i -= 1
  }
  if (trailerStart <= end) {
    while (i >= 0 && lines[i].trim() === '') i -= 1
    end = i
  }

  if (end < 0) return ''
  return lines
    .slice(0, end + 1)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 解析更新动态可见性 trailer。
 * - `Changelog: skip`：不进入更新动态（即使 feat/fix）
 * - `Changelog: show`：强制进入（chore 等也会收录，类别缺省为体验优化）
 * @param {string} [body]
 * @returns {'skip' | 'show' | null}
 */
export function parseChangelogVisibility(body) {
  const raw = String(body ?? '').replace(/\r\n/g, '\n')
  if (!raw.trim()) return null
  const lines = raw.split('\n')
  /** @type {'skip' | 'show' | null} */
  let last = null
  for (const line of lines) {
    const m = /^\s*Changelog:\s*(skip|show|hide|include)\s*$/i.exec(line)
    if (!m) continue
    const v = m[1].toLowerCase()
    if (v === 'skip' || v === 'hide') last = 'skip'
    else if (v === 'show' || v === 'include') last = 'show'
  }
  return last
}

/**
 * @param {string} subject
 * @returns {{ type: string; scope: string; title: string } | null}
 */
export function parseConventionalSubject(subject) {
  const raw = String(subject ?? '').trim()
  if (!raw || /^merge\b/i.test(raw)) return null
  const match = SUBJECT_RE.exec(raw)
  if (!match?.groups) return null
  const type = match.groups.type.toLowerCase()
  const scope = String(match.groups.scope || '').trim().toLowerCase()
  const title = String(match.groups.title || '').trim()
  if (!title) return null
  return { type, scope, title }
}

/**
 * @param {string} scope
 * @returns {string[]}
 */
export function modulesFromScope(scope) {
  const key = String(scope || '').trim().toLowerCase()
  if (!key) return []
  const mapped = SCOPE_TO_MODULE[key]
  if (mapped) return [mapped]
  return ['other']
}

/**
 * @param {{
 *   hash: string
 *   subject: string
 *   date: string
 *   body?: string
 *   commitUrl?: string | null
 * }} commit
 * @param {{ includeImprovementTypes?: boolean }} [options]
 * @returns {WhatsNewItem | null}
 */
export function commitToWhatsNewItem(commit, options = {}) {
  const parsed = parseConventionalSubject(commit.subject)
  if (!parsed) return null

  const visibility = parseChangelogVisibility(commit.body)
  if (visibility === 'skip') return null

  const includeImprovement = Boolean(options.includeImprovementTypes)
  const allowed = includeImprovement
    ? new Set([...WHATS_NEW_INCLUDED_TYPES, 'perf', 'refactor'])
    : WHATS_NEW_INCLUDED_TYPES

  const forceShow = visibility === 'show'
  if (!forceShow && !allowed.has(parsed.type)) return null

  /** @type {WhatsNewCategory | undefined} */
  let category = CONVENTIONAL_TYPE_TO_CATEGORY[parsed.type]
  if (!category) {
    if (!forceShow) return null
    category = 'improvement'
  }

  const publishedAt = String(commit.date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return null
  const summary = formatCommitBodyAsSummary(commit.body)
  return {
    id: String(commit.hash || '').trim().slice(0, 40),
    title: parsed.title,
    category,
    modules: modulesFromScope(parsed.scope),
    publishedAt,
    appVersion: null,
    summary,
    commitUrl: commit.commitUrl ?? null,
    source: 'git',
  }
}

/**
 * @param {WhatsNewItem[]} items
 * @param {number} [limit]
 * @returns {WhatsNewItem[]}
 */
export function truncateWhatsNewItems(items, limit = 200) {
  const list = Array.isArray(items) ? items : []
  const max = Math.max(0, Number(limit) || 0)
  if (!max || list.length <= max) return list
  return list.slice(0, max)
}

/**
 * @param {WhatsNewItem[]} items
 * @returns {Record<string, WhatsNewItem[]>}
 */
export function groupWhatsNewItemsByMonth(items) {
  /** @type {Record<string, WhatsNewItem[]>} */
  const groups = {}
  for (const item of items || []) {
    const month = String(item.publishedAt || '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) continue
    if (!groups[month]) groups[month] = []
    groups[month].push(item)
  }
  return groups
}

/**
 * @param {WhatsNewFeed | null | undefined} feed
 * @returns {string | null}
 */
export function latestWhatsNewSignal(feed) {
  const items = feed?.items
  if (!Array.isArray(items) || items.length === 0) return null
  let latest = ''
  for (const item of items) {
    const d = String(item.publishedAt || '')
    if (d > latest) latest = d
  }
  return latest || null
}

/**
 * @returns {string | null}
 */
export function getWhatsNewFeedLastSeenAt() {
  try {
    const value = localStorage.getItem(WHATS_NEW_FEED_LAST_SEEN_KEY)
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

/**
 * @param {string} [isoOrDate]
 */
export function markWhatsNewFeedSeen(isoOrDate = new Date().toISOString()) {
  try {
    localStorage.setItem(WHATS_NEW_FEED_LAST_SEEN_KEY, String(isoOrDate))
  } catch {
    /* ignore */
  }
}

/**
 * @param {WhatsNewFeed | null | undefined} feed
 * @param {string | null} [lastSeenAt]
 * @returns {boolean}
 */
export function hasUnreadWhatsNewFeed(feed, lastSeenAt = getWhatsNewFeedLastSeenAt()) {
  const signal = latestWhatsNewSignal(feed)
  if (!signal) return false
  if (!lastSeenAt) return true
  return signal > lastSeenAt.slice(0, Math.max(signal.length, 10))
}

/**
 * @param {unknown} raw
 * @returns {WhatsNewFeed}
 */
export function normalizeWhatsNewFeed(raw) {
  const obj = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const itemsIn = Array.isArray(obj.items) ? obj.items : []
  /** @type {WhatsNewItem[]} */
  const items = []
  for (const row of itemsIn) {
    if (!row || typeof row !== 'object') continue
    const r = /** @type {Record<string, unknown>} */ (row)
    const id = String(r.id || '').trim()
    const title = String(r.title || '').trim()
    const category = String(r.category || '').trim()
    const publishedAt = String(r.publishedAt || '').slice(0, 10)
    if (!id || !title) continue
    if (category !== 'feature' && category !== 'fix' && category !== 'improvement') continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) continue
    items.push({
      id,
      title,
      category,
      modules: Array.isArray(r.modules)
        ? r.modules.map((m) => String(m).trim()).filter(Boolean)
        : [],
      publishedAt,
      appVersion: r.appVersion == null ? null : String(r.appVersion),
      summary: String(r.summary || ''),
      commitUrl: r.commitUrl == null || r.commitUrl === '' ? null : String(r.commitUrl),
      source: 'git',
    })
  }
  return {
    generatedAt: String(obj.generatedAt || ''),
    source: 'git',
    since: obj.since == null ? undefined : String(obj.since),
    repoCommit: obj.repoCommit == null ? undefined : String(obj.repoCommit),
    items,
  }
}
