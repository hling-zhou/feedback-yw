import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  parseSmsChannelWorkbook,
  parseOfficialChannelWorkbook,
  buildMergedPostUseRows,
} from './parseChannels.js'
import {
  computeExternalMixedMetrics,
  computeInternalSatisfactionMetrics,
  POST_USE_SMALL_SAMPLE_N,
} from './metrics.js'
import {
  POST_USE_RATING_PRODUCT_NAMES,
  scopePostUseRatingRecords,
} from '../productCatalog/postUseRatingProducts.js'
import { ensureTargetProductsInCatalog } from '../productCatalog/ensureTargetProducts.js'
import { applySpecMergeRules } from '../productCatalog/specMergeRules.js'

const refDir = path.resolve(process.cwd(), 'data/用后即评参考')
const smsPath = path.join(refDir, '6 月-短信渠道.xls')
const webPath = path.join(refDir, '6 月-官网渠道.xls')
const hasJune = fs.existsSync(smsPath) && fs.existsSync(webPath)

describe('postUseRating catalog seed', () => {
  it('ensures 13 云网 products with analysisPostUseRating', () => {
    const { products, changed } = ensureTargetProductsInCatalog([])
    expect(changed).toBe(true)
    const pur = products.filter((p) => p.analysisPostUseRating)
    const names = new Set(pur.map((p) => p.name))
    for (const n of POST_USE_RATING_PRODUCT_NAMES) {
      expect(names.has(n), `missing ${n}`).toBe(true)
    }
    expect(pur.length).toBeGreaterThanOrEqual(13)
    expect(products.find((p) => p.key === 'shared_bw')?.name).toBe('共享带宽')
    // 子产品已降为父产品的规格，不再作为独立产品存在
    for (const legacyKey of ['ssl_vpn', 'ipsec_vpn', 'peering', 'security_group', 'cloud_interconnect']) {
      expect(products.some((p) => p.key === legacyKey), `${legacyKey} 应已并入父产品`).toBe(false)
    }
    const vpn = products.find((p) => p.key === 'vpn')
    expect(vpn?.name).toBe('融合VPN')
    expect(vpn?.specs?.map((s) => s.name)).toEqual(['SSL VPN', 'IPSec VPN'])
    const vpc = products.find((p) => p.key === 'vpc')
    expect(vpc?.specs?.some((s) => s.name === '对等连接')).toBe(true)
    expect(vpc?.specs?.some((s) => s.name === '安全组')).toBe(true)
    const cc = products.find((p) => p.key === 'cc')
    expect(cc?.specs?.some((s) => s.name === '云互联')).toBe(true)
    const sba = products.find((p) => p.key === 'sba')
    expect(sba?.specs?.map((s) => s.name)).toEqual(['场景化加速', '数据快递'])
  })
})

describe.skipIf(!hasJune)('postUseRating June gold', () => {
  function loadMerged() {
    const smsBuf = fs.readFileSync(smsPath)
    const webBuf = fs.readFileSync(webPath)
    const sms = parseSmsChannelWorkbook(
      smsBuf.buffer.slice(smsBuf.byteOffset, smsBuf.byteOffset + smsBuf.byteLength),
    )
    const web = parseOfficialChannelWorkbook(
      webBuf.buffer.slice(webBuf.byteOffset, webBuf.byteOffset + webBuf.byteLength),
    )
    return buildMergedPostUseRows({
      smsRows: sms.rows,
      consoleRows: web.score?.rows || [],
      callbackRows: web.callback?.rows || [],
    })
  }

  /**
   * 复刻应用真实口径（importSession.js）：先按产品目录把原始行归一化，
   * 再用归一化后的行算指标；公司级口径仍取全量原始行。
   */
  let analysisCache = null
  function loadAnalysis() {
    if (analysisCache) return analysisCache
    const merged = loadMerged()
    const { products: catalog } = applySpecMergeRules(ensureTargetProductsInCatalog([]).products)
    const analysisRows = scopePostUseRatingRecords(merged.scored, catalog)
    analysisCache = { merged, catalog, analysisRows }
    return analysisCache
  }

  it('parses channel counts and dedupes to 13567', () => {
    const merged = loadMerged()
    expect(merged.counts.sms).toBe(108)
    expect(merged.counts.console).toBe(12539)
    expect(merged.counts.callback).toBe(921)
    expect(merged.counts.beforeDedupe).toBe(13568)
    expect(merged.counts.scoredMerged).toBe(13567)
  })

  it('matches PRD external mixed metrics (allow ±1 sample)', () => {
    const { merged, analysisRows } = loadAnalysis()
    const ext = computeExternalMixedMetrics(analysisRows, {
      productNames: [...POST_USE_RATING_PRODUCT_NAMES],
      companyRows: merged.scored,
    })
    // 合并后云网产品数 16 → 12（SSL VPN/IPSec VPN 合成融合VPN，其余 3 个并入已有父产品）
    expect(ext.yunwang.productCount).toBe(12)
    expect(ext.yunwang.avgScore).toBe(9.93)
    expect(ext.yunwang.belowNineCount).toBe(1)
    expect(ext.yunwang.belowNineRatio).toBe(8.33)
    // 样本总量不变：子产品样本被归到父产品，未被丢弃
    expect(ext.yunwang.totalSample).toBeGreaterThanOrEqual(4115)
    expect(ext.yunwang.totalSample).toBeLessThanOrEqual(4116)
    expect(ext.company.productCount).toBe(89)
    expect(ext.company.totalSample).toBe(13567)
    expect(ext.company.avgScore).toBe(9.79)
  })

  it('computes satisfaction rates; small-n products marked reference', () => {
    const { analysisRows } = loadAnalysis()
    const sat = computeInternalSatisfactionMetrics(analysisRows, {
      productNames: [...POST_USE_RATING_PRODUCT_NAMES],
      smallSampleN: POST_USE_SMALL_SAMPLE_N,
    })
    const byName = Object.fromEntries(sat.byProduct.map((p) => [p.productName, p]))
    expect(byName['弹性公网IP'].rate).toBe(90)
    // 并入「对等连接 / 安全组」后样本 12 → 15，满意度跌破 88% 达标线
    expect(byName['虚拟私有云'].rate).toBe(86.67)
    expect(byName['虚拟私有云'].smallSample).toBe(false)
    expect(byName['虚拟私有云'].belowBaseline).toBe(true)
    // SSL VPN / IPSec VPN 合并为融合VPN，仍属小样本
    expect(byName['融合VPN'].rate).toBe(83.33)
    expect(byName['融合VPN'].smallSample).toBe(true)
    expect(sat.totalSample).toBeGreaterThan(0)
    expect(sat.tenCount).toBeLessThanOrEqual(sat.totalSample)
    expect(sat.rate).toBeGreaterThan(0)
  })
})
