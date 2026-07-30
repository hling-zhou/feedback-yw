import { randomId } from '../lib/randomId.js'
/** @typedef {import('./enums.js').InsightPeriodStatus} InsightPeriodStatus */
/** @typedef {import('./enums.js').PeriodGranularity} PeriodGranularity */

/**
 * @typedef {Object} InsightPeriod
 * @property {string} id
 * @property {string} label
 * @property {string} startDate
 * @property {string} endDate
 * @property {PeriodGranularity} [granularity] month | quarter | year | custom
 * @property {number} [anchorYear]
 * @property {number} [anchorMonth] 1–12，仅 month
 * @property {number} [anchorQuarter] 1–4，仅 quarter
 * @property {string} [customFromMonth] YYYY-MM，仅 custom
 * @property {string} [customToMonth] YYYY-MM，仅 custom
 * @property {InsightPeriodStatus} status
 * @property {string} tenantId
 * @property {string} schemaVersion
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @param {number} year
 * @param {number} month 1–12
 */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * @param {number} year
 * @param {number} month 1–12
 */
function monthRange(year, month) {
  const m = Math.min(12, Math.max(1, month))
  const last = daysInMonth(year, m)
  return {
    startDate: `${year}-${String(m).padStart(2, '0')}-01`,
    endDate: `${year}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
  }
}

/**
 * @param {number} year
 * @param {number} quarter 1–4
 */
function quarterRange(year, quarter) {
  const q = Math.min(4, Math.max(1, quarter))
  const starts = ['01-01', '04-01', '07-01', '10-01']
  const ends = ['03-31', '06-30', '09-30', '12-31']
  return {
    startDate: `${year}-${starts[q - 1]}`,
    endDate: `${year}-${ends[q - 1]}`,
    label: `${year}年Q${q}`,
  }
}

/**
 * @param {number} year
 */
function yearRange(year) {
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    label: `${year}年`,
  }
}

/**
 * @param {unknown} value
 * @returns {string | null} YYYY-MM
 */
export function normalizeYearMonth(value) {
  if (value == null) return null
  const s = String(value).trim()
  const m = /^(\d{4})-(\d{2})$/.exec(s)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (!Number.isFinite(year) || year < 1970 || year > 2100) return null
  if (!Number.isFinite(month) || month < 1 || month > 12) return null
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * @param {string} fromYm YYYY-MM
 * @param {string} toYm YYYY-MM
 */
export function listMonthsInclusive(fromYm, toYm) {
  const from = normalizeYearMonth(fromYm)
  const to = normalizeYearMonth(toYm)
  if (!from || !to || from > to) return []
  /** @type {string[]} */
  const out = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/**
 * @param {string} ym YYYY-MM
 * @param {number} delta
 */
export function shiftYearMonth(ym, delta) {
  const normalized = normalizeYearMonth(ym)
  if (!normalized) return null
  let [y, m] = normalized.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  const ny = Math.floor(idx / 12)
  const nm = (idx % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

/**
 * @param {string} fromYm
 * @param {string} toYm
 */
function formatCustomPeriodLabel(fromYm, toYm) {
  const [fy, fm] = fromYm.split('-').map(Number)
  const [ty, tm] = toYm.split('-').map(Number)
  if (fy === ty) {
    if (fm === tm) return `${fy}年${fm}月`
    return `${fy}年${fm}月–${tm}月`
  }
  return `${fy}年${fm}月–${ty}年${tm}月`
}

/**
 * @param {Object} spec
 * @param {PeriodGranularity} spec.granularity
 * @param {number} [spec.year]
 * @param {number} [spec.month]
 * @param {number} [spec.quarter]
 * @param {string} [spec.fromMonth] YYYY-MM，custom
 * @param {string} [spec.toMonth] YYYY-MM，custom
 */
export function buildPeriodSpec({ granularity, year, month, quarter, fromMonth, toMonth }) {
  if (granularity === 'custom') {
    const from = normalizeYearMonth(fromMonth)
    const to = normalizeYearMonth(toMonth)
    if (!from || !to) {
      throw new Error('请选择起止月份')
    }
    if (from > to) {
      throw new Error('结束月份不能早于开始月份')
    }
    const [fy, fm] = from.split('-').map(Number)
    const [ty, tm] = to.split('-').map(Number)
    const start = monthRange(fy, fm)
    const end = monthRange(ty, tm)
    return {
      label: formatCustomPeriodLabel(from, to),
      startDate: start.startDate,
      endDate: end.endDate,
      granularity: /** @type {const} */ ('custom'),
      customFromMonth: from,
      customToMonth: to,
      anchorYear: ty,
    }
  }

  const y = Number(year)
  if (!Number.isFinite(y) || y < 1970 || y > 2100) {
    throw new Error('请选择有效年份')
  }

  if (granularity === 'month') {
    const m = month ?? new Date().getMonth() + 1
    const range = monthRange(y, m)
    return {
      label: `${y}年${m}月`,
      ...range,
      granularity: 'month',
      anchorYear: y,
      anchorMonth: m,
    }
  }

  if (granularity === 'quarter') {
    const q = quarter ?? Math.ceil((new Date().getMonth() + 1) / 3)
    const built = quarterRange(y, q)
    return {
      label: built.label,
      startDate: built.startDate,
      endDate: built.endDate,
      granularity: 'quarter',
      anchorYear: y,
      anchorQuarter: q,
    }
  }

  if (granularity === 'year') {
    const built = yearRange(y)
    return {
      label: built.label,
      startDate: built.startDate,
      endDate: built.endDate,
      granularity: 'year',
      anchorYear: y,
    }
  }

  throw new Error('不支持的周期类型')
}

/**
 * @param {ReturnType<typeof buildPeriodSpec>} spec
 * @returns {ReturnType<typeof buildPeriodSpec> | null}
 */
export function previousPeriodSpecFromSpec(spec) {
  if (spec.granularity === 'custom' && spec.customFromMonth && spec.customToMonth) {
    const months = listMonthsInclusive(spec.customFromMonth, spec.customToMonth)
    if (!months.length) return null
    const len = months.length
    const prevTo = shiftYearMonth(spec.customFromMonth, -1)
    const prevFrom = shiftYearMonth(spec.customFromMonth, -len)
    if (!prevFrom || !prevTo) return null
    return buildPeriodSpec({
      granularity: 'custom',
      fromMonth: prevFrom,
      toMonth: prevTo,
    })
  }
  if (spec.granularity === 'month' && spec.anchorYear != null && spec.anchorMonth != null) {
    let year = spec.anchorYear
    let month = spec.anchorMonth - 1
    if (month < 1) {
      month = 12
      year -= 1
    }
    return buildPeriodSpec({ granularity: 'month', year, month })
  }
  if (spec.granularity === 'quarter' && spec.anchorYear != null && spec.anchorQuarter != null) {
    let year = spec.anchorYear
    let quarter = spec.anchorQuarter - 1
    if (quarter < 1) {
      quarter = 4
      year -= 1
    }
    return buildPeriodSpec({ granularity: 'quarter', year, quarter })
  }
  if (spec.granularity === 'year' && spec.anchorYear != null) {
    return buildPeriodSpec({ granularity: 'year', year: spec.anchorYear - 1 })
  }
  return null
}

/**
 * @param {InsightPeriod | null | undefined} period
 * @returns {ReturnType<typeof buildPeriodSpec> | null}
 */
function periodToBuildSpec(period) {
  if (!period?.granularity) return null
  if (period.granularity === 'custom') {
    const from = period.customFromMonth || period.startDate?.slice(0, 7)
    const to = period.customToMonth || period.endDate?.slice(0, 7)
    if (!from || !to) return null
    return buildPeriodSpec({ granularity: 'custom', fromMonth: from, toMonth: to })
  }
  if (period.anchorYear == null) return null
  return buildPeriodSpec({
    granularity: period.granularity,
    year: period.anchorYear,
    month: period.anchorMonth,
    quarter: period.anchorQuarter,
  })
}

/**
 * @param {InsightPeriod | null | undefined} period
 * @returns {string | null}
 */
export function previousPeriodIdFromPeriod(period) {
  if (!period) return null
  const normalized = normalizeInsightPeriod(period)
  const spec = periodToBuildSpec(normalized)
  if (!spec) return null
  const prev = previousPeriodSpecFromSpec(spec)
  return prev ? periodIdFromSpec(prev) : null
}

/**
 * 上一洞察周期对象（月 → 上月，季 → 上季，年 → 上年，自定义 → 等长前一窗）
 * @param {InsightPeriod | null | undefined} period
 * @returns {InsightPeriod | null}
 */
export function resolvePreviousInsightPeriod(period) {
  if (!period) return null
  const normalized = normalizeInsightPeriod(period)
  const spec = periodToBuildSpec(normalized)
  if (!spec) return null
  const prevSpec = previousPeriodSpecFromSpec(spec)
  if (!prevSpec) return null
  return insightPeriodFromSpec(
    prevSpec,
    normalized.schemaVersion || '2.0',
    normalized.tenantId || 'local',
  )
}

export function periodIdFromSpec(spec) {
  if (spec.granularity === 'month') {
    return `period:month:${spec.anchorYear}-${String(spec.anchorMonth).padStart(2, '0')}`
  }
  if (spec.granularity === 'quarter') {
    return `period:quarter:${spec.anchorYear}-Q${spec.anchorQuarter}`
  }
  if (spec.granularity === 'custom') {
    return `period:custom:${spec.customFromMonth}_${spec.customToMonth}`
  }
  return `period:year:${spec.anchorYear}`
}

/**
 * 从稳定周期 ID 反推规格（用于 periods 列表尚未同步时的即时筛选）
 * @param {string} [periodId]
 * @returns {ReturnType<typeof buildPeriodSpec> | null}
 */
export function periodSpecFromId(periodId) {
  if (!periodId || periodId === 'legacy-default') return null
  const customMatch = /^period:custom:(\d{4}-\d{2})_(\d{4}-\d{2})$/.exec(periodId)
  if (customMatch) {
    return buildPeriodSpec({
      granularity: 'custom',
      fromMonth: customMatch[1],
      toMonth: customMatch[2],
    })
  }
  const monthMatch = /^period:month:(\d{4})-(\d{2})$/.exec(periodId)
  if (monthMatch) {
    return buildPeriodSpec({
      granularity: 'month',
      year: Number(monthMatch[1]),
      month: Number(monthMatch[2]),
    })
  }
  const quarterMatch = /^period:quarter:(\d{4})-Q([1-4])$/.exec(periodId)
  if (quarterMatch) {
    return buildPeriodSpec({
      granularity: 'quarter',
      year: Number(quarterMatch[1]),
      quarter: Number(quarterMatch[2]),
    })
  }
  const yearMatch = /^period:year:(\d{4})$/.exec(periodId)
  if (yearMatch) {
    return buildPeriodSpec({ granularity: 'year', year: Number(yearMatch[1]) })
  }
  return null
}

/**
 * @param {string} periodId
 * @param {InsightPeriod | null | undefined} [fromList]
 * @param {string} [schemaVersion]
 * @param {string} [tenantId]
 * @returns {InsightPeriod | null}
 */
export function resolveInsightPeriod(periodId, fromList, schemaVersion = '2.0', tenantId = 'local') {
  if (!periodId) return fromList ? normalizeInsightPeriod(fromList) : null
  if (fromList?.id === periodId && fromList.granularity) {
    return normalizeInsightPeriod(fromList)
  }
  const spec = periodSpecFromId(periodId)
  if (spec) return insightPeriodFromSpec(spec, schemaVersion, tenantId)
  return fromList ? normalizeInsightPeriod(fromList) : null
}

/**
 * @param {InsightPeriod | null | undefined} period
 * @returns {{
 *   granularity: PeriodGranularity
 *   year?: number
 *   month?: number
 *   quarter?: number
 *   fromMonth?: string
 *   toMonth?: string
 * } | null}
 */
export function selectionFromPeriod(period) {
  if (!period?.granularity) return null
  if (period.granularity === 'custom') {
    const from = period.customFromMonth || period.startDate?.slice(0, 7)
    const to = period.customToMonth || period.endDate?.slice(0, 7)
    if (!from || !to) return null
    return {
      granularity: 'custom',
      year: Number(to.slice(0, 4)) || period.anchorYear,
      fromMonth: from,
      toMonth: to,
    }
  }
  if (period.anchorYear == null) return null
  return {
    granularity: period.granularity,
    year: period.anchorYear,
    month: period.anchorMonth,
    quarter: period.anchorQuarter,
  }
}

/**
 * @param {ReturnType<typeof buildPeriodSpec>} spec
 * @param {string} schemaVersion
 * @param {string} [tenantId]
 * @returns {InsightPeriod}
 */
export function insightPeriodFromSpec(spec, schemaVersion, tenantId = 'local') {
  return createInsightPeriod(
    {
      id: periodIdFromSpec(spec),
      label: spec.label,
      startDate: spec.startDate,
      endDate: spec.endDate,
      granularity: spec.granularity,
      anchorYear: spec.anchorYear,
      anchorMonth: spec.anchorMonth,
      anchorQuarter: spec.anchorQuarter,
      customFromMonth: spec.customFromMonth,
      customToMonth: spec.customToMonth,
      status: 'active',
    },
    schemaVersion,
    tenantId,
  )
}

/**
 * 当前自然月 / 季 / 年的快捷规格
 * @param {PeriodGranularity} granularity
 */
export function currentPeriodSpec(granularity) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const quarter = Math.ceil(month / 3)
  if (granularity === 'custom') {
    const to = `${year}-${String(month).padStart(2, '0')}`
    const from = shiftYearMonth(to, -2) || to
    return buildPeriodSpec({ granularity: 'custom', fromMonth: from, toMonth: to })
  }
  return buildPeriodSpec({ granularity, year, month, quarter })
}

/**
 * 默认按月洞察：当前自然年内有数据的最新月份；无数据则当前自然月。
 * @param {import('../lib/types.js').FeedbackRecord[]} [records]
 */
export function defaultMonthPeriodSpec(records = []) {
  const year = new Date().getFullYear()
  let latestMonth = 0
  for (const r of records) {
    const dateStr = recordDataDate(r)
    const monthKey = dateStr?.slice(0, 7)
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) continue
    const [y, m] = monthKey.split('-').map(Number)
    if (y !== year || !m) continue
    if (m > latestMonth) latestMonth = m
  }
  if (latestMonth > 0) {
    return buildPeriodSpec({ granularity: 'month', year, month: latestMonth })
  }
  return currentPeriodSpec('month')
}

/**
 * defaultMonthPeriodSpec 的月份聚合版：入参为 month-summary 的 months，
 * 语义等价（recordDataDate 优先 importMonth），避免为推断默认周期全表下载。
 * @param {Array<{ importMonth: string; count: number }>} [months]
 */
export function defaultMonthPeriodSpecFromMonths(months = []) {
  const year = new Date().getFullYear()
  let latestMonth = 0
  for (const row of months) {
    const monthKey = typeof row?.importMonth === 'string' ? row.importMonth.slice(0, 7) : ''
    if (!/^\d{4}-\d{2}$/.test(monthKey) || !(row.count > 0)) continue
    const [y, m] = monthKey.split('-').map(Number)
    if (y !== year || !m) continue
    if (m > latestMonth) latestMonth = m
  }
  if (latestMonth > 0) {
    return buildPeriodSpec({ granularity: 'month', year, month: latestMonth })
  }
  return currentPeriodSpec('month')
}

/**
 * @param {InsightPeriod} period
 */
export function normalizeInsightPeriod(period) {
  if (period.granularity === 'custom') {
    const from = period.customFromMonth || period.startDate?.slice(0, 7)
    const to = period.customToMonth || period.endDate?.slice(0, 7)
    if (from && to) {
      try {
        const spec = buildPeriodSpec({
          granularity: 'custom',
          fromMonth: from,
          toMonth: to,
        })
        return {
          ...period,
          label: period.label || spec.label,
          startDate: spec.startDate,
          endDate: spec.endDate,
          granularity: 'custom',
          customFromMonth: spec.customFromMonth,
          customToMonth: spec.customToMonth,
          anchorYear: spec.anchorYear,
          anchorMonth: undefined,
          anchorQuarter: undefined,
        }
      } catch {
        return period
      }
    }
    return period
  }

  if (period.granularity && period.anchorYear) {
    try {
      const spec = buildPeriodSpec({
        granularity: period.granularity,
        year: period.anchorYear,
        month: period.anchorMonth,
        quarter: period.anchorQuarter,
      })
      return {
        ...period,
        label: period.label || spec.label,
        startDate: spec.startDate,
        endDate: spec.endDate,
        granularity: spec.granularity,
        anchorYear: spec.anchorYear,
        anchorMonth: spec.anchorMonth,
        anchorQuarter: spec.anchorQuarter,
      }
    } catch {
      return period
    }
  }

  const inferred = inferGranularityFromDates(period.startDate, period.endDate)
  if (inferred) {
    return normalizeInsightPeriod({ ...period, ...inferred })
  }

  return period
}

/**
 * @param {string} startDate
 * @param {string} endDate
 */
function inferGranularityFromDates(startDate, endDate) {
  if (!startDate || !endDate) return null
  const y = Number(startDate.slice(0, 4))
  if (!Number.isFinite(y)) return null

  if (startDate.endsWith('-01-01') && endDate === `${y}-12-31`) {
    return buildPeriodSpec({ granularity: 'year', year: y })
  }

  for (let q = 1; q <= 4; q++) {
    const r = quarterRange(y, q)
    if (startDate === r.startDate && endDate === r.endDate) {
      return buildPeriodSpec({ granularity: 'quarter', year: y, quarter: q })
    }
  }

  const m = Number(startDate.slice(5, 7))
  if (m >= 1 && m <= 12) {
    const r = monthRange(y, m)
    if (startDate === r.startDate && endDate === r.endDate) {
      return buildPeriodSpec({ granularity: 'month', year: y, month: m })
    }
  }

  return null
}

/**
 * @param {InsightPeriod} period
 */
export function formatPeriodRange(period) {
  if (!period) return '—'
  const p = normalizeInsightPeriod(period)
  return `${p.startDate} ~ ${p.endDate}`
}

/**
 * @param {InsightPeriod} period
 */
export function formatPeriodSubtitle(period) {
  if (!period) return ''
  const p = normalizeInsightPeriod(period)
  const type =
    p.granularity === 'month'
      ? '按月'
      : p.granularity === 'quarter'
        ? '按季度'
        : p.granularity === 'year'
          ? '按年'
          : p.granularity === 'custom'
            ? '自定义'
            : ''
  return type ? `${type} · ${formatPeriodRange(p)}` : formatPeriodRange(p)
}

/**
 * @param {string} importMonth YYYY-MM
 */
export function periodSpecFromImportMonth(importMonth) {
  const [y, m] = importMonth.split('-').map(Number)
  if (!y || !m) throw new Error('无效的数据月份')
  return buildPeriodSpec({ granularity: 'month', year: y, month: m })
}

export function suggestImportMonth(period) {
  if (!period) return new Date().toISOString().slice(0, 7)
  const p = normalizeInsightPeriod(period)
  if (p.granularity === 'month' && p.anchorYear && p.anchorMonth) {
    return `${p.anchorYear}-${String(p.anchorMonth).padStart(2, '0')}`
  }
  if (p.granularity === 'custom' && p.customToMonth) {
    return p.customToMonth
  }
  if (p.endDate) return p.endDate.slice(0, 7)
  return new Date().toISOString().slice(0, 7)
}

/**
 * 记录用于周期匹配的数据日期（优先 importMonth，其次 createdAt / importedAt）
 * @param {import('../lib/types.js').FeedbackRecord} record
 * @returns {string} YYYY-MM-DD，无则空串
 */
export function recordDataDate(record) {
  const month = record?.importMonth
  if (month && /^\d{4}-\d{2}/.test(String(month))) {
    return `${String(month).slice(0, 7)}-01`
  }
  const created = record?.createdAt?.slice(0, 10)
  if (created) return created
  const imported = record?.importedAt?.slice(0, 10)
  if (imported) return imported
  return ''
}

/**
 * 判断记录是否落在洞察周期内（按数据时间，与导入时所属周期 ID 无关）
 * @param {import('../lib/types.js').FeedbackRecord} record
 * @param {InsightPeriod | null | undefined} period
 */
export function recordMatchesPeriod(record, period) {
  if (!period) return true
  const p = normalizeInsightPeriod(period)
  if (p.startDate === '2000-01-01' && p.endDate === '2099-12-31') return true
  const date = recordDataDate(record)
  if (!date) return false
  return isDateInPeriod(date, p)
}

/**
 * @param {string} importMonth YYYY-MM
 * @param {InsightPeriod} period
 */
export function isImportMonthInPeriod(importMonth, period) {
  if (!importMonth || !period) return true
  const p = normalizeInsightPeriod(period)
  const [y, m] = importMonth.split('-').map(Number)
  if (!y || !m) return true

  if (p.granularity === 'month' && p.anchorYear && p.anchorMonth) {
    return y === p.anchorYear && m === p.anchorMonth
  }

  const day = `${importMonth}-01`
  return isDateInPeriod(day, p)
}

/**
 * @param {Partial<InsightPeriod> & Pick<InsightPeriod, 'label' | 'startDate' | 'endDate'>} input
 * @param {string} schemaVersion
 * @param {string} [tenantId]
 * @returns {InsightPeriod}
 */
export function createInsightPeriod(input, schemaVersion, tenantId = 'local') {
  const now = new Date().toISOString()
  const base = {
    id: input.id || randomId(),
    label: input.label,
    startDate: input.startDate,
    endDate: input.endDate,
    granularity: input.granularity,
    anchorYear: input.anchorYear,
    anchorMonth: input.anchorMonth,
    anchorQuarter: input.anchorQuarter,
    customFromMonth: input.customFromMonth,
    customToMonth: input.customToMonth,
    status: input.status || 'active',
    tenantId: input.tenantId || tenantId,
    schemaVersion,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  }
  return normalizeInsightPeriod(/** @type {InsightPeriod} */ (base))
}

/**
 * @param {string} dateIso YYYY-MM-DD
 * @param {Pick<InsightPeriod, 'startDate' | 'endDate'>} period
 */
export function isDateInPeriod(dateIso, period) {
  if (!dateIso) return true
  const day = dateIso.slice(0, 10)
  return day >= period.startDate && day <= period.endDate
}

/**
 * @param {InsightPeriod} a
 * @param {InsightPeriod} b
 */
export function isSamePeriodAnchor(a, b) {
  const x = normalizeInsightPeriod(a)
  const y = normalizeInsightPeriod(b)
  if (!x.granularity || x.granularity !== y.granularity) return false
  if (x.granularity === 'custom') {
    return x.customFromMonth === y.customFromMonth && x.customToMonth === y.customToMonth
  }
  if (x.anchorYear !== y.anchorYear) return false
  if (x.granularity === 'month') return x.anchorMonth === y.anchorMonth
  if (x.granularity === 'quarter') return x.anchorQuarter === y.anchorQuarter
  return true
}
