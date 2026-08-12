/**
 * 用后即评指标计算（对内分口径 / 对外混算）
 */
import { POST_USE_RATING_PRODUCT_NAMES } from '../productCatalog/postUseRatingProducts.js'

/** @typedef {import('./parseChannels.js').NormalizedPostUseRow} NormalizedPostUseRow */

/** 小样本阈值（方案锁定） */
export const POST_USE_SMALL_SAMPLE_N = 10

/** 投诉回访满意度达标线 */
export const POST_USE_SATISFACTION_BASELINE = 0.88

/** 体验均分关注线 */
export const POST_USE_SCORE_BASELINE = 9

/**
 * PRD 主子产品映射（公司级所有产品）
 * @type {Record<string, string>}
 */
export const SUB_PRODUCT_MAP = {
  '云主机 ECS': '云主机',
  '云电脑（信创型）': '云电脑',
  '云电脑（办公型）': '云电脑',
  '云电脑（行业型）': '云电脑',
  '云硬盘 EBS': '云硬盘',
  '对象存储 EOS': '对象存储',
  '容器服务 KCS': '容器服务',
  '容器镜像服务 CIS': '容器镜像服务',
  'Web全栈防护（专业版）': 'Web全栈防护',
  'Web全栈防护（云原生版）': 'Web全栈防护',
  'Web全栈防护（独享信创版）': 'Web全栈防护',
  '专属宿主机 DDH': '专属宿主机',
  '全栈专属服务 ECSO(H)': '全栈专属云ECSO',
}

/**
 * @param {number} n
 * @param {number} [digits]
 */
function round2(n, digits = 2) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/**
 * @param {NormalizedPostUseRow[]} rows
 * @param {string[]} productNames
 */
function filterByProducts(rows, productNames) {
  const set = new Set(productNames)
  return rows.filter((r) => set.has(r.productName))
}

/**
 * @param {NormalizedPostUseRow[]} rows
 */
export function aggregateByProduct(rows) {
  /** @type {Map<string, { productName: string; scores: number[]; sampleSize: number; avgScore: number }>} */
  const map = new Map()
  for (const row of rows) {
    if (!row.productName || !Number.isFinite(row.score)) continue
    let g = map.get(row.productName)
    if (!g) {
      g = { productName: row.productName, scores: [], sampleSize: 0, avgScore: 0 }
      map.set(row.productName, g)
    }
    g.scores.push(row.score)
  }
  for (const g of map.values()) {
    g.sampleSize = g.scores.length
    g.avgScore = g.sampleSize ? round2(g.scores.reduce((a, b) => a + b, 0) / g.sampleSize) : 0
  }
  return [...map.values()].sort((a, b) => a.productName.localeCompare(b.productName, 'zh'))
}

/**
 * 对内：产品体验口径（短信+控制台）
 * @param {NormalizedPostUseRow[]} scoredRows
 * @param {{ productNames?: string[]; smallSampleN?: number }} [opts]
 */
export function computeInternalExperienceMetrics(scoredRows, opts = {}) {
  const productNames = opts.productNames || [...POST_USE_RATING_PRODUCT_NAMES]
  const smallN = opts.smallSampleN ?? POST_USE_SMALL_SAMPLE_N
  const experience = scoredRows.filter((r) => r.channel === 'sms' || r.channel === 'console')
  const scoped = filterByProducts(experience, productNames)
  const byProduct = aggregateByProduct(scoped).map((p) => ({
    ...p,
    smallSample: p.sampleSize < smallN,
    belowNine: p.avgScore < POST_USE_SCORE_BASELINE,
  }))
  const totalSample = scoped.length
  const avgScore = totalSample
    ? round2(scoped.reduce((a, r) => a + r.score, 0) / totalSample)
    : 0
  const belowNineProducts = byProduct.filter((p) => !p.smallSample && p.belowNine)
  return {
    scope: 'internal_experience',
    channels: ['sms', 'console'],
    productCount: byProduct.length,
    totalSample,
    avgScore,
    belowNineCount: belowNineProducts.length,
    belowNineRatio: byProduct.length
      ? round2((belowNineProducts.length / byProduct.length) * 100)
      : 0,
    byProduct,
    smallSampleN: smallN,
  }
}

/**
 * 对内：投诉回访满意度
 * @param {NormalizedPostUseRow[]} scoredRows
 * @param {{ productNames?: string[]; smallSampleN?: number; baseline?: number }} [opts]
 */
export function computeInternalSatisfactionMetrics(scoredRows, opts = {}) {
  const productNames = opts.productNames || [...POST_USE_RATING_PRODUCT_NAMES]
  const smallN = opts.smallSampleN ?? POST_USE_SMALL_SAMPLE_N
  const baseline = opts.baseline ?? POST_USE_SATISFACTION_BASELINE
  const callback = filterByProducts(
    scoredRows.filter((r) => r.channel === 'callback'),
    productNames,
  )
  /** @type {Map<string, { productName: string; sampleSize: number; tenCount: number; rate: number; smallSample: boolean; belowBaseline: boolean }>} */
  const map = new Map()
  for (const row of callback) {
    let g = map.get(row.productName)
    if (!g) {
      g = {
        productName: row.productName,
        sampleSize: 0,
        tenCount: 0,
        rate: 0,
        smallSample: false,
        belowBaseline: false,
      }
      map.set(row.productName, g)
    }
    g.sampleSize += 1
    if (row.score === 10) g.tenCount += 1
  }
  const byProduct = [...map.values()]
    .map((g) => {
      const rate = g.sampleSize ? g.tenCount / g.sampleSize : 0
      const smallSample = g.sampleSize < smallN
      return {
        ...g,
        rate: round2(rate * 100),
        smallSample,
        belowBaseline: !smallSample && rate < baseline,
      }
    })
    .sort((a, b) => a.productName.localeCompare(b.productName, 'zh'))

  return {
    scope: 'internal_satisfaction',
    baseline: baseline * 100,
    smallSampleN: smallN,
    byProduct,
    notQualified: byProduct.filter((p) => p.belowBaseline),
  }
}

/**
 * 对外：PRD 三渠道混算（云网 + 公司级）
 * @param {NormalizedPostUseRow[]} scoredRows
 * @param {{ productNames?: string[] }} [opts]
 */
export function computeExternalMixedMetrics(scoredRows, opts = {}) {
  const productNames = opts.productNames || [...POST_USE_RATING_PRODUCT_NAMES]
  const yw = filterByProducts(scoredRows, productNames)
  const ywByProduct = aggregateByProduct(yw)
  const ywTotal = yw.length
  const ywAvg = ywTotal ? round2(yw.reduce((a, r) => a + r.score, 0) / ywTotal) : 0
  const below9 = ywByProduct.filter((p) => p.avgScore < 9)

  const mapped = scoredRows.map((r) => ({
    ...r,
    productName: SUB_PRODUCT_MAP[r.productName] || r.productName,
  }))
  const allByProduct = aggregateByProduct(mapped)
  const allTotal = mapped.length
  const allAvg = allTotal ? round2(mapped.reduce((a, r) => a + r.score, 0) / allTotal) : 0

  return {
    scope: 'external_mixed',
    yunwang: {
      productCount: ywByProduct.length,
      totalSample: ywTotal,
      avgScore: ywAvg,
      belowNineCount: below9.length,
      belowNineRatio: ywByProduct.length
        ? round2((below9.length / ywByProduct.length) * 100)
        : 0,
      byProduct: ywByProduct,
    },
    company: {
      productCount: allByProduct.length,
      totalSample: allTotal,
      avgScore: allAvg,
      byProduct: allByProduct,
    },
  }
}

/**
 * 非10分分布（得分 round 后分档）
 * @param {NormalizedPostUseRow[]} scoredRows
 * @param {string[]} nonTenProductNames 均分 != 10 的产品名
 */
export function computeScoreDistribution(scoredRows, nonTenProductNames) {
  const set = new Set(nonTenProductNames)
  /** @type {Record<string, Record<string, number>>} */
  const result = {}
  for (const name of nonTenProductNames) {
    result[name] = {
      sampleSize: 0,
      10: 0,
      9: 0,
      8: 0,
      7: 0,
      6: 0,
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
    }
  }
  for (const row of scoredRows) {
    if (!set.has(row.productName) || !Number.isFinite(row.score)) continue
    const rounded = Math.round(row.score)
    if (rounded < 1 || rounded > 10) continue
    const bucket = result[row.productName]
    bucket.sampleSize += 1
    bucket[String(rounded)] += 1
  }
  return result
}
