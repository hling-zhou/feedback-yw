/**
 * 痛点聚类性能基准（M1/M2）
 * 用法: node scripts/benchmark-clustering.mjs [product]
 */
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runProductClusteringPipeline } from '../src/lib/painPointClustering/runProductClusteringPipeline.js'
import { runPrimaryClustering } from '../src/lib/painPointClustering/primaryCluster.js'
import { primaryGroupKey } from '../src/lib/painPointClustering/primaryCluster.js'
import { getRecordDataSourceType, getRecordPainPoint } from '../src/lib/painPointClustering/clusterLabel.js'
import { buildCandidatePairKeys } from '../src/lib/painPointClustering/jaccardCandidatePairs.js'
import { tokenSetFromPainPoint } from '../src/lib/painPointClustering/textTokenize.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = join(__dirname, '../server/data/auth.db')

/** @param {string} productFilter */
function loadRecords(productFilter) {
  const db = new Database(dbPath, { readonly: true })
  const rows = db.prepare('SELECT payload FROM records').all()
  db.close()
  /** @type {import('../src/lib/types.js').FeedbackRecord[]} */
  const records = rows.map((r) => JSON.parse(r.payload))
  if (!productFilter) return records
  return records.filter((r) => (r.product || '').trim() === productFilter)
}

/**
 * @param {import('../src/lib/types.js').FeedbackRecord[]} records
 * @param {string} product
 */
function findWorstGroup(records, product) {
  /** @type {Map<string, import('../src/lib/types.js').FeedbackRecord[]>} */
  const groups = new Map()
  for (const r of records) {
    if ((r.product || '').trim() !== product) continue
    const pain = getRecordPainPoint(r)
    if (!pain) continue
    const key = primaryGroupKey(product, getRecordDataSourceType(r), r.journeyL1?.trim() || '未识别环节')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  let worst = { key: '', size: 0, records: /** @type {import('../src/lib/types.js').FeedbackRecord[]} */ ([]) }
  for (const [key, groupRecords] of groups) {
    if (groupRecords.length > worst.size) {
      worst = { key, size: groupRecords.length, records: groupRecords }
    }
  }
  return worst
}

const product = process.argv[2] || '弹性公网IP'
const records = loadRecords(product)
console.log(`Product: ${product}, records: ${records.length}`)

const worst = findWorstGroup(records, product)
console.log(`Worst group: ${worst.key.replace(/\0/g, ' × ')}, size=${worst.size}`)

const tokenSets = worst.records.map((r) => tokenSetFromPainPoint(getRecordPainPoint(r)))
const pairs1 = buildCandidatePairKeys(tokenSets.length, tokenSets, 1)
const pairs2 = buildCandidatePairKeys(tokenSets.length, tokenSets, 2)
console.log(`Candidate pairs (minShared=1): ${pairs1.size}`)
console.log(`Candidate pairs (minShared=2): ${pairs2.size}`)

const t0 = performance.now()
runPrimaryClustering(worst.records, product)
console.log(`runPrimaryClustering (worst group only): ${(performance.now() - t0).toFixed(0)}ms`)

const t1 = performance.now()
runProductClusteringPipeline(records, product)
console.log(`runProductClusteringPipeline (full product): ${(performance.now() - t1).toFixed(0)}ms`)
