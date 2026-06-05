/**
 * 满意度回访记录 — 补全到投诉/咨询工单的领域模型。
 * @see docs/DESIGN-用后即评-满意度回访.md
 */

/** @typedef {'resolved' | 'unresolved'} FollowUpProblemResolved */
/** @typedef {'satisfaction_callback' | 'web_survey' | 'sms_survey'} FollowUpSourceSubType */

/**
 * @typedef {Object} DissatisfiedReasonParts
 * @property {string} [overallService]
 * @property {string} [handlingDurationScore]
 * @property {string} [handlingDurationReason]
 * @property {string} [staffAttitudeScore]
 * @property {string} [staffAttitudeReason]
 * @property {string} [staffCapabilityScore]
 * @property {string} [staffCapabilityReason]
 * @property {string} [phoneCallbackOpinion]
 */

/**
 * @typedef {Object} FollowUpSatisfaction
 * @property {string} followUpTicketId
 * @property {number} [score]
 * @property {FollowUpProblemResolved | null} [problemResolved]
 * @property {string} [dissatisfiedReasons]
 * @property {DissatisfiedReasonParts} [dissatisfiedReasonParts]
 * @property {string} [remark]
 * @property {boolean} followUpSuccessful
 * @property {string} [importMonth]
 * @property {FollowUpSourceSubType} [sourceSubType]
 * @property {string} [importBatchId]
 * @property {string} [importedAt]
 */

export const FOLLOW_UP_SOURCE_SUBTYPE_SATISFACTION_CALLBACK = /** @type {const} */ (
  'satisfaction_callback'
)

/** 报表列名 → parts 字段（design §3.2） */
export const SATISFACTION_CALLBACK_REPORT_COLUMNS = /** @type {const} */ ({
  followUpTicketId: '回访工单编号',
  originalTicketId: '原工单编号',
  productSpec: '具体投诉产品',
  followUpSuccessful: '是否回访成功',
  problemResolved: '之前您反映的问题是否得到解决',
  score: '请您对本次投诉的整体服务情况进行评价',
  overallService: '整体服务情况不满意原因',
  handlingDurationScore: '请您对问题处理时长进行评价',
  handlingDurationReason: '处理时长不满意原因',
  staffAttitudeScore: '请您对服务人员的服务态度进行评价',
  staffAttitudeReason: '服务人员的服务态度不满意原因',
  staffCapabilityScore: '请您对服务人员的业务能力进行评价',
  staffCapabilityReason: '服务人员的业务能力不满意原因',
  phoneCallbackOpinion: '电话回访意见',
  remark: '备注',
})

/** @type {(keyof DissatisfiedReasonParts)[]} */
export const DISSATISFIED_REASON_PART_KEYS = [
  'overallService',
  'handlingDurationScore',
  'handlingDurationReason',
  'staffAttitudeScore',
  'staffAttitudeReason',
  'staffCapabilityScore',
  'staffCapabilityReason',
  'phoneCallbackOpinion',
]

/** 工作台「不满意原因分布」仅统计文本原因维度（不含 *Score 评分列） */
export const DISSATISFIED_REASON_ANALYSIS_DIM_KEYS = /** @type {const} */ ([
  'overallService',
  'handlingDurationReason',
  'staffAttitudeReason',
  'staffCapabilityReason',
  'phoneCallbackOpinion',
])

const REASON_PART_LABELS = /** @type {Record<keyof DissatisfiedReasonParts, string>} */ ({
  overallService: SATISFACTION_CALLBACK_REPORT_COLUMNS.overallService,
  handlingDurationScore: SATISFACTION_CALLBACK_REPORT_COLUMNS.handlingDurationScore,
  handlingDurationReason: SATISFACTION_CALLBACK_REPORT_COLUMNS.handlingDurationReason,
  staffAttitudeScore: SATISFACTION_CALLBACK_REPORT_COLUMNS.staffAttitudeScore,
  staffAttitudeReason: SATISFACTION_CALLBACK_REPORT_COLUMNS.staffAttitudeReason,
  staffCapabilityScore: SATISFACTION_CALLBACK_REPORT_COLUMNS.staffCapabilityScore,
  staffCapabilityReason: SATISFACTION_CALLBACK_REPORT_COLUMNS.staffCapabilityReason,
  phoneCallbackOpinion: SATISFACTION_CALLBACK_REPORT_COLUMNS.phoneCallbackOpinion,
})

const PROBLEM_RESOLVED_LABELS = /** @type {Record<FollowUpProblemResolved, string>} */ ({
  resolved: '已解决',
  unresolved: '未解决',
})

const DISPLAY_RESOLVED_PATTERN = /^(\d{1,2})\s*[（(]\s*(已解决|未解决)\s*[）)]$/

/**
 * 回访不满意子维度中视为「无内容」的占位值（不参与展示与统计）。
 * @param {string | undefined | null} raw
 */
export function isMeaningfulDissatisfiedReasonValue(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return false
  if (/^(无|暂无|没有|—|-+|n\/a|null)$/i.test(s)) return false
  return true
}

/**
 * @param {DissatisfiedReasonParts | undefined | null} parts
 * @returns {DissatisfiedReasonParts}
 */
export function sanitizeDissatisfiedReasonParts(parts) {
  if (!parts) return {}
  /** @type {DissatisfiedReasonParts} */
  const out = {}
  for (const key of DISSATISFIED_REASON_PART_KEYS) {
    const value = String(parts[key] ?? '').trim()
    if (isMeaningfulDissatisfiedReasonValue(value)) {
      out[key] = value
    }
  }
  return out
}

/**
 * 从已拼接的汇总文本中剔除「维度：无」类段落（兼容历史入库数据）。
 * @param {string | undefined | null} text
 */
export function sanitizeDissatisfiedReasonsSummary(text) {
  const s = String(text ?? '').trim()
  if (!s) return ''
  if (isMeaningfulDissatisfiedReasonValue(s) && !s.includes('：') && !s.includes(':')) {
    return s
  }
  const separator = s.includes('；') ? '；' : s.includes(';') ? ';' : null
  if (!separator) {
    const colonIdx = s.search(/[：:]/)
    if (colonIdx < 0) {
      return isMeaningfulDissatisfiedReasonValue(s) ? s : ''
    }
    const value = s.slice(colonIdx + 1).trim()
    return isMeaningfulDissatisfiedReasonValue(value) ? s : ''
  }
  return s
    .split(separator)
    .map((chunk) => chunk.trim())
    .filter((chunk) => {
      if (!chunk) return false
      const colonIdx = chunk.search(/[：:]/)
      if (colonIdx < 0) return isMeaningfulDissatisfiedReasonValue(chunk)
      const value = chunk.slice(colonIdx + 1).trim()
      return isMeaningfulDissatisfiedReasonValue(value)
    })
    .join('；')
}

/**
 * 展示/导出用不满意原因：优先结构化 parts，回退汇总文本并过滤占位「无」。
 * @param {FollowUpSatisfaction | null | undefined} fu
 */
export function resolveFollowUpDissatisfiedReasons(fu) {
  if (!fu) return ''
  const parts = sanitizeDissatisfiedReasonParts(fu.dissatisfiedReasonParts)
  const fromParts = buildDissatisfiedReasonsSummary(parts)
  if (fromParts) return fromParts
  return sanitizeDissatisfiedReasonsSummary(fu.dissatisfiedReasons)
}

/**
 * @param {string | undefined | null} raw
 */
export function parseYesNo(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return false
  if (/^(是|yes|y|true|1|成功|回访成功)$/i.test(s)) return true
  if (/^(否|no|n|false|0|失败|不成功|未成功)$/i.test(s)) return false
  return s === '是'
}

/**
 * @param {string | undefined | null} raw
 * @returns {FollowUpProblemResolved | null}
 */
export function parseProblemResolved(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (/已解决|解决了|解决/.test(s) && !/未/.test(s)) return 'resolved'
  if (/未解决|没解决|尚未解决|没有解决/.test(s)) return 'unresolved'
  if (/^yes|是$/i.test(s)) return 'resolved'
  if (/^no|否$/i.test(s)) return 'unresolved'
  return null
}

/**
 * @param {string | number | undefined | null} raw
 * @returns {number | undefined}
 */
export function parseFollowUpScore(raw) {
  if (raw == null || raw === '') return undefined
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n)) return undefined
  const rounded = Math.round(n)
  if (rounded < 1 || rounded > 10) return undefined
  return rounded
}

/**
 * @param {Record<string, string | undefined>} [row]
 * @param {Partial<typeof SATISFACTION_CALLBACK_REPORT_COLUMNS>} [columnMap]
 * @returns {DissatisfiedReasonParts}
 */
export function buildDissatisfiedReasonPartsFromRow(row = {}, columnMap = SATISFACTION_CALLBACK_REPORT_COLUMNS) {
  /** @type {DissatisfiedReasonParts} */
  const parts = {}
  for (const key of DISSATISFIED_REASON_PART_KEYS) {
    const header = columnMap[key]
    if (!header) continue
    const value = String(row[header] ?? '').trim()
    if (isMeaningfulDissatisfiedReasonValue(value)) parts[key] = value
  }
  return parts
}

/**
 * @param {DissatisfiedReasonParts | undefined | null} parts
 * @param {{ separator?: string }} [options]
 */
export function buildDissatisfiedReasonsSummary(parts, options = {}) {
  const separator = options.separator ?? '；'
  if (!parts) return ''
  /** @type {string[]} */
  const chunks = []
  for (const key of DISSATISFIED_REASON_PART_KEYS) {
    const value = String(parts[key] ?? '').trim()
    if (!isMeaningfulDissatisfiedReasonValue(value)) continue
    chunks.push(`${REASON_PART_LABELS[key]}：${value}`)
  }
  return chunks.join(separator)
}

/**
 * @param {Partial<FollowUpSatisfaction> | null | undefined} input
 * @returns {FollowUpSatisfaction | null}
 */
export function normalizeFollowUpSatisfaction(input) {
  if (!input) return null
  const followUpTicketId = String(input.followUpTicketId ?? '').trim()
  if (!followUpTicketId) return null

  const score = parseFollowUpScore(input.score)
  const problemResolved =
    input.problemResolved === 'resolved' || input.problemResolved === 'unresolved'
      ? input.problemResolved
      : parseProblemResolved(input.problemResolved)

  const parts = sanitizeDissatisfiedReasonParts(input.dissatisfiedReasonParts)
  const dissatisfiedReasons =
    buildDissatisfiedReasonsSummary(parts) ||
    sanitizeDissatisfiedReasonsSummary(String(input.dissatisfiedReasons ?? '').trim())

  const importMonth = normalizeImportMonth(input.importMonth)

  return {
    followUpTicketId,
    score,
    problemResolved: problemResolved ?? null,
    dissatisfiedReasons: dissatisfiedReasons || undefined,
    dissatisfiedReasonParts: Object.keys(parts).length ? parts : undefined,
    remark: String(input.remark ?? '').trim() || undefined,
    followUpSuccessful: Boolean(input.followUpSuccessful),
    importMonth: importMonth || undefined,
    sourceSubType: input.sourceSubType || FOLLOW_UP_SOURCE_SUBTYPE_SATISFACTION_CALLBACK,
    importBatchId: input.importBatchId || undefined,
    importedAt: input.importedAt || undefined,
  }
}

/**
 * @param {string | undefined | null} value
 */
function normalizeImportMonth(value) {
  const s = String(value ?? '').trim()
  return /^\d{4}-\d{2}$/.test(s) ? s : ''
}

/**
 * @param {FollowUpSatisfaction | null | undefined} fu
 */
export function formatFollowUpSatisfactionDisplay(fu) {
  if (!fu?.followUpSuccessful) return ''
  const score = fu.score
  if (score == null) return ''
  const resolvedLabel =
    fu.problemResolved === 'resolved'
      ? PROBLEM_RESOLVED_LABELS.resolved
      : fu.problemResolved === 'unresolved'
        ? PROBLEM_RESOLVED_LABELS.unresolved
        : ''
  if (!resolvedLabel) return String(score)
  return `${score}（${resolvedLabel}）`
}

/**
 * @param {string | undefined | null} text
 * @returns {{ score?: number; problemResolved?: FollowUpProblemResolved | null } | null}
 */
export function parseFollowUpSatisfactionDisplay(text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  const m = s.match(DISPLAY_RESOLVED_PATTERN)
  if (m) {
    return {
      score: parseFollowUpScore(m[1]),
      problemResolved: m[2] === PROBLEM_RESOLVED_LABELS.resolved ? 'resolved' : 'unresolved',
    }
  }
  const scoreOnly = parseFollowUpScore(s)
  if (scoreOnly != null) return { score: scoreOnly, problemResolved: null }
  return null
}

/**
 * @param {FollowUpSatisfaction | null | undefined} fu
 * @param {string | undefined | null} ticketImportMonth
 */
export function resolveFollowUpTrendMonth(fu, ticketImportMonth) {
  const fromFollowUp = normalizeImportMonth(fu?.importMonth)
  if (fromFollowUp) return fromFollowUp
  const fromTicket = normalizeImportMonth(ticketImportMonth)
  if (fromTicket) return fromTicket
  return ''
}

/**
 * @param {import('../lib/types.js').FeedbackRecord | null | undefined} record
 */
export function hasFollowUpSatisfaction(record) {
  const fu = record?.followUpSatisfaction
  return Boolean(fu?.followUpSuccessful && fu.score != null)
}

/**
 * @param {import('../lib/types.js').FeedbackRecord | null | undefined} record
 * @returns {number | undefined}
 */
export function getFollowUpScore(record) {
  const score = record?.followUpSatisfaction?.score
  return score != null ? parseFollowUpScore(score) : undefined
}

/**
 * @param {import('../lib/types.js').FeedbackRecord} record
 * @param {Partial<FollowUpSatisfaction>} patch
 * @param {{ outOfPeriodWarning?: boolean }} [options]
 * @returns {import('../lib/types.js').FeedbackRecord}
 */
export function applyFollowUpSatisfactionPatch(record, patch, options = {}) {
  const normalized = normalizeFollowUpSatisfaction({
    ...record.followUpSatisfaction,
    ...patch,
    followUpSuccessful: patch.followUpSuccessful ?? record.followUpSatisfaction?.followUpSuccessful ?? true,
  })
  if (!normalized) return record

  /** @type {import('../lib/types.js').FeedbackRecord} */
  const next = {
    ...record,
    followUpSatisfaction: normalized,
  }
  if (options.outOfPeriodWarning) {
    next.outOfPeriodWarning = true
  }
  return next
}

/**
 * 从回访报表行构建 FollowUpSatisfaction（不含匹配工单）。
 *
 * @param {Record<string, string>} row
 * @param {{ importMonth?: string; importBatchId?: string; importedAt?: string; columnMap?: Partial<typeof SATISFACTION_CALLBACK_REPORT_COLUMNS> }} [options]
 */
export function buildFollowUpSatisfactionFromReportRow(row, options = {}) {
  const columnMap = { ...SATISFACTION_CALLBACK_REPORT_COLUMNS, ...options.columnMap }
  const followUpSuccessful = parseYesNo(row[columnMap.followUpSuccessful])
  const parts = buildDissatisfiedReasonPartsFromRow(row, columnMap)

  return normalizeFollowUpSatisfaction({
    followUpTicketId: row[columnMap.followUpTicketId],
    score: parseFollowUpScore(row[columnMap.score]),
    problemResolved: parseProblemResolved(row[columnMap.problemResolved]),
    dissatisfiedReasonParts: parts,
    remark: row[columnMap.remark],
    followUpSuccessful,
    importMonth: options.importMonth,
    importBatchId: options.importBatchId,
    importedAt: options.importedAt || new Date().toISOString(),
    sourceSubType: FOLLOW_UP_SOURCE_SUBTYPE_SATISFACTION_CALLBACK,
  })
}

export { PROBLEM_RESOLVED_LABELS }
