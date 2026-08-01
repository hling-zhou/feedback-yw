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
import { POST_USE_RATING_PRODUCT_NAMES } from '../productCatalog/postUseRatingProducts.js'
import { ensureTargetProductsInCatalog } from '../productCatalog/ensureTargetProducts.js'

const refDir = path.resolve(process.cwd(), 'data/用后即评参考')
const smsPath = path.join(refDir, '6 月-短信渠道.xls')
const webPath = path.join(refDir, '6 月-官网渠道.xls')
const hasJune = fs.existsSync(smsPath) && fs.existsSync(webPath)

describe('postUseRating catalog seed', () => {
  it('ensures 16 云网 products with analysisPostUseRating', () => {
    const { products, changed } = ensureTargetProductsInCatalog([])
    expect(changed).toBe(true)
    const pur = products.filter((p) => p.analysisPostUseRating)
    const names = new Set(pur.map((p) => p.name))
    for (const n of POST_USE_RATING_PRODUCT_NAMES) {
      expect(names.has(n), `missing ${n}`).toBe(true)
    }
    expect(pur.length).toBeGreaterThanOrEqual(16)
    expect(products.find((p) => p.key === 'shared_bw')?.name).toBe('共享带宽')
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

  it('parses channel counts and dedupes to 13567', () => {
    const merged = loadMerged()
    expect(merged.counts.sms).toBe(108)
    expect(merged.counts.console).toBe(12539)
    expect(merged.counts.callback).toBe(921)
    expect(merged.counts.beforeDedupe).toBe(13568)
    expect(merged.counts.scoredMerged).toBe(13567)
  })

  it('matches PRD external mixed metrics (allow ±1 sample)', () => {
    const merged = loadMerged()
    const ext = computeExternalMixedMetrics(merged.scored, {
      productNames: [...POST_USE_RATING_PRODUCT_NAMES],
    })
    expect(ext.yunwang.productCount).toBe(16)
    expect(ext.yunwang.avgScore).toBe(9.93)
    expect(ext.yunwang.belowNineCount).toBe(2)
    expect(ext.yunwang.belowNineRatio).toBe(12.5)
    expect(ext.yunwang.totalSample).toBeGreaterThanOrEqual(4115)
    expect(ext.yunwang.totalSample).toBeLessThanOrEqual(4116)
    expect(ext.company.productCount).toBe(89)
    expect(ext.company.totalSample).toBe(13567)
    expect(ext.company.avgScore).toBe(9.79)
  })

  it('computes satisfaction rates; small-n products marked reference', () => {
    const merged = loadMerged()
    const sat = computeInternalSatisfactionMetrics(merged.scored, {
      productNames: [...POST_USE_RATING_PRODUCT_NAMES],
      smallSampleN: POST_USE_SMALL_SAMPLE_N,
    })
    const byName = Object.fromEntries(sat.byProduct.map((p) => [p.productName, p]))
    expect(byName['弹性公网IP'].rate).toBe(90)
    expect(byName['虚拟私有云'].rate).toBe(91.67)
    expect(byName['IPSec VPN'].rate).toBe(75)
    expect(byName['IPSec VPN'].smallSample).toBe(true)
    expect(byName['对等连接'].rate).toBe(66.67)
    expect(byName['对等连接'].smallSample).toBe(true)
    expect(sat.totalSample).toBeGreaterThan(0)
    expect(sat.tenCount).toBeLessThanOrEqual(sat.totalSample)
    expect(sat.rate).toBeGreaterThan(0)
  })
})
