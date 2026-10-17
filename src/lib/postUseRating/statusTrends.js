import { listMonthsInclusive } from '../../domain/insightPeriod.js'
import {
  computeExternalMixedMetrics,
  computeInternalExperienceMetrics,
  computeInternalSatisfactionMetrics,
} from './metrics.js'
import { postUseRecordsToScoredRows } from './scoredRows.js'
import { postUsePeriodMonths } from './periodScope.js'

const EXPERIENCE_AREAS = [{ dataKey: 'departmentScore', name: '体验均分', stroke: '#2563EB' }]
const SATISFACTION_AREAS = [{ dataKey: 'departmentRate', name: '投诉回访满意度', stroke: '#059669' }]
const THREE_CHANNEL_AREAS = [
  { dataKey: 'department', name: '部门均分（三渠道）', stroke: '#7C3AED' },
  { dataKey: 'company', name: '公司均分（三渠道）', stroke: '#D97706' },
]
const COMBINED_AREAS = [
  { dataKey: 'departmentScore', name: '部门体验均分', stroke: '#2563EB', yAxisId: 'score', domain: [0, 10] },
  { dataKey: 'department', name: '部门均分（三渠道）', stroke: '#7C3AED', yAxisId: 'score', domain: [0, 10] },
  { dataKey: 'company', name: '公司均分（三渠道）', stroke: '#D97706', yAxisId: 'score', domain: [0, 10] },
  {
    dataKey: 'departmentRate',
    name: '部门投诉回访满意度',
    stroke: '#059669',
    yAxisId: 'rate',
    orientation: 'right',
    domain: [0, 100],
  },
]

/** @param {Date} [date] */
export function currentYearMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** @param {object} record */
export function postUseRecordMonth(record) {
  const month = String(record?.importMonth || record?.createdAt || '').slice(0, 7)
  return /^\d{4}-\d{2}$/.test(month) ? month : ''
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

export function emptyDepartmentStatusTrends() {
  return {
    pending: false,
    experience: { data: [], areas: EXPERIENCE_AREAS },
    satisfaction: { data: [], areas: SATISFACTION_AREAS },
    threeChannel: { data: [], areas: THREE_CHANNEL_AREAS },
    combined: { data: [], areas: COMBINED_AREAS },
    companyMetrics: [],
  }
}

export function pendingDepartmentStatusTrends() {
  return { ...emptyDepartmentStatusTrends(), pending: true }
}

/**
 * @param {unknown} raw
 */
export function normalizeDepartmentStatusTrends(raw) {
  if (!raw || typeof raw !== 'object') return emptyDepartmentStatusTrends()
  const source = /** @type {ReturnType<typeof emptyDepartmentStatusTrends>} */ (raw)
  const pickChart = (chart, areas) => ({
    data: Array.isArray(chart?.data) ? chart.data : [],
    areas: Array.isArray(chart?.areas) && chart.areas.length ? chart.areas : areas,
  })
  return {
    pending: false,
    experience: pickChart(source.experience, EXPERIENCE_AREAS),
    satisfaction: pickChart(source.satisfaction, SATISFACTION_AREAS),
    threeChannel: pickChart(source.threeChannel, THREE_CHANNEL_AREAS),
    combined: source.combined?.data?.length
      ? pickChart(source.combined, COMBINED_AREAS)
      : combineStatusTrendCharts(source.experience, source.satisfaction, source.threeChannel),
    companyMetrics: Array.isArray(source.companyMetrics)
      ? source.companyMetrics
        .map((row) => ({
          date: String(row?.date || ''),
          avgScore: Number.isFinite(Number(row?.avgScore)) ? Number(row.avgScore) : null,
          totalSample: Number(row?.totalSample) || 0,
          productCount: Number(row?.productCount) || 0,
          scoreSum: Number(row?.scoreSum) || 0,
        }))
        .filter((row) => /^\d{4}-\d{2}$/.test(row.date))
      : undefined,
  }
}

/**
 * 把服务端按月公司口径汇总到当前周期（加权均分 = 各月分数合计 / 样本合计）。
 * @param {Array<{ date?: string, avgScore?: number | null, totalSample?: number, productCount?: number, scoreSum?: number }> | null | undefined} companyMetrics
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 */
export function rollupCompanyMetrics(companyMetrics, period) {
  const months = new Set(postUsePeriodMonths(period))
  const rows = (companyMetrics || []).filter((row) => months.has(String(row?.date || '')) && Number(row?.totalSample) > 0)
  const totalSample = rows.reduce((sum, row) => sum + Number(row.totalSample || 0), 0)
  const scoreSum = rows.reduce((sum, row) => {
    const sample = Number(row.totalSample || 0)
    if (row.scoreSum != null && Number.isFinite(Number(row.scoreSum))) return sum + Number(row.scoreSum)
    const avg = Number(row.avgScore)
    return sum + (Number.isFinite(avg) ? avg * sample : 0)
  }, 0)
  return {
    avgScore: totalSample ? round2(scoreSum / totalSample) : null,
    totalSample,
    productCount: rows.length === 1 ? Number(rows[0].productCount) || 0 : 0,
  }
}

/**
 * @param {object[]} records
 * @returns {Map<string, object[]>}
 */
function scoredRowsByMonth(records) {
  /** @type {Map<string, object[]>} */
  const grouped = new Map()
  for (const record of records || []) {
    const month = postUseRecordMonth(record)
    if (!month) continue
    const bucket = grouped.get(month)
    if (bucket) bucket.push(record)
    else grouped.set(month, [record])
  }
  /** @type {Map<string, object[]>} */
  const scored = new Map()
  for (const [month, bucket] of grouped) {
    const rows = postUseRecordsToScoredRows(bucket)
    if (rows.length) scored.set(month, rows)
  }
  return scored
}

/**
 * @param {number} sampleSize
 * @param {number} value
 */
function valueOrNull(sampleSize, value) {
  return sampleSize > 0 && Number.isFinite(value) ? value : null
}

/**
 * @param {{ data?: object[] } | null | undefined} experience
 * @param {{ data?: object[] } | null | undefined} satisfaction
 * @param {{ data?: object[] } | null | undefined} threeChannel
 */
export function combineStatusTrendCharts(experience, satisfaction, threeChannel) {
  const byDate = new Map()
  const take = (rows, assign) => {
    for (const row of rows || []) {
      const date = String(row?.date || '')
      if (!/^\d{4}-\d{2}$/.test(date)) continue
      const current = byDate.get(date) || { date }
      assign(current, row)
      byDate.set(date, current)
    }
  }
  take(experience?.data, (current, row) => {
    current.departmentScore = row.departmentScore ?? null
  })
  take(satisfaction?.data, (current, row) => {
    current.departmentRate = row.departmentRate ?? null
  })
  take(threeChannel?.data, (current, row) => {
    current.department = row.department ?? null
    current.company = row.company ?? null
  })
  const data = [...byDate.keys()].sort().map((date) => ({
    date,
    departmentScore: byDate.get(date).departmentScore ?? null,
    departmentRate: byDate.get(date).departmentRate ?? null,
    department: byDate.get(date).department ?? null,
    company: byDate.get(date).company ?? null,
  }))
  return { data, areas: COMBINED_AREAS }
}

/**
 * 横轴截到看板月份：保留系统有数据的最早月，去掉看板月份之后的点。
 * @param {ReturnType<typeof emptyDepartmentStatusTrends> | null | undefined} trends
 * @param {string} [endMonth] YYYY-MM
 */
export function clipDepartmentStatusTrends(trends, endMonth) {
  if (!trends) return emptyDepartmentStatusTrends()
  const end = String(endMonth || '').slice(0, 7)
  const clipChart = (chart) => ({
    ...chart,
    data: (chart?.data || []).filter((row) => String(row.date || '') <= end),
  })
  if (!/^\d{4}-\d{2}$/.test(end)) {
    return {
      ...trends,
      combined: trends.combined?.data?.length
        ? trends.combined
        : combineStatusTrendCharts(trends.experience, trends.satisfaction, trends.threeChannel),
    }
  }
  const experience = clipChart(trends.experience)
  const satisfaction = clipChart(trends.satisfaction)
  const threeChannel = clipChart(trends.threeChannel)
  return {
    ...trends,
    experience,
    satisfaction,
    threeChannel,
    combined: combineStatusTrendCharts(experience, satisfaction, threeChannel),
    companyMetrics: Array.isArray(trends.companyMetrics)
      ? trends.companyMetrics.filter((row) => String(row.date || '') <= end)
      : trends.companyMetrics,
  }
}

/**
 * 部门体验均分、部门投诉回访满意度、部门与公司三渠道均分。
 * 横轴从最早有评分的月份连续到看板月份；没有样本的月份留空。
 * @param {{
 *   departmentRecords?: object[]
 *   companyRecords?: object[]
 *   productNames?: string[]
 *   nowMonth?: string
 * }} [input]
 */
export function buildDepartmentStatusTrends(input = {}) {
  const {
    departmentRecords = [],
    companyRecords = [],
    productNames = [],
    nowMonth,
  } = input
  const departmentByMonth = scoredRowsByMonth(departmentRecords)
  const companyByMonth = scoredRowsByMonth(companyRecords)
  const scoredMonths = [...new Set([...departmentByMonth.keys(), ...companyByMonth.keys()])].sort()
  if (!scoredMonths.length) return emptyDepartmentStatusTrends()

  const endMonth = /^\d{4}-\d{2}$/.test(nowMonth || '') ? nowMonth : currentYearMonth()
  const range = listMonthsInclusive(scoredMonths[0], endMonth)
  const experience = []
  const satisfaction = []
  const threeChannel = []
  const companyMetrics = []

  for (const month of range) {
    const departmentScored = departmentByMonth.get(month) || []
    const companyScored = companyByMonth.get(month) || []
    const exp = computeInternalExperienceMetrics(departmentScored, { productNames })
    const sat = computeInternalSatisfactionMetrics(departmentScored, { productNames })
    const mixed = computeExternalMixedMetrics(departmentScored, {
      productNames,
      companyRows: companyScored,
    })
    experience.push({
      date: month,
      departmentScore: valueOrNull(exp.totalSample, exp.avgScore),
    })
    satisfaction.push({
      date: month,
      departmentRate: valueOrNull(sat.totalSample, sat.rate),
    })
    threeChannel.push({
      date: month,
      department: valueOrNull(mixed.yunwang.totalSample, mixed.yunwang.avgScore),
      company: valueOrNull(mixed.company.totalSample, mixed.company.avgScore),
    })
    if (mixed.company.totalSample > 0) {
      companyMetrics.push({
        date: month,
        avgScore: mixed.company.avgScore,
        totalSample: mixed.company.totalSample,
        productCount: mixed.company.productCount,
        scoreSum: companyScored.reduce((sum, row) => sum + Number(row.score || 0), 0),
      })
    }
  }

  return {
    pending: false,
    experience: { data: experience, areas: EXPERIENCE_AREAS },
    satisfaction: { data: satisfaction, areas: SATISFACTION_AREAS },
    threeChannel: { data: threeChannel, areas: THREE_CHANNEL_AREAS },
    combined: combineStatusTrendCharts(
      { data: experience },
      { data: satisfaction },
      { data: threeChannel },
    ),
    companyMetrics,
  }
}
