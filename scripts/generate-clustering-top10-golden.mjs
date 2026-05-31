/**
 * 从 golden 数据集生成 Top10 fingerprint golden（M2-4）
 * 用法: node scripts/generate-clustering-top10-golden.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CLUSTERING_GOLDEN_PRODUCTS,
  CLUSTERING_GOLDEN_RECORDS,
} from '../src/lib/painPointClustering/fixtures/clusteringGoldenDataset.js'
import { productTop10Fingerprints } from '../src/lib/painPointClustering/clusterTop10Fingerprint.js'
import { runProductClusteringPipeline } from '../src/lib/painPointClustering/runProductClusteringPipeline.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.join(
  __dirname,
  '../src/lib/painPointClustering/fixtures/clusteringTop10Golden.js',
)

/** @type {Record<string, string[]>} */
const golden = {}
for (const product of CLUSTERING_GOLDEN_PRODUCTS) {
  const result = runProductClusteringPipeline(CLUSTERING_GOLDEN_RECORDS, product)
  golden[product] = productTop10Fingerprints(result)
  console.log(`${product}: top ${golden[product].length} clusters`)
}

const content = `/**
 * M2-4 Top10 golden fingerprints（由 scripts/generate-clustering-top10-golden.mjs 生成）
 * 算法有意变更且 τ 门禁更新时重新生成。
 */
/** @type {Record<string, string[]>} */
export const CLUSTERING_TOP10_GOLDEN = ${JSON.stringify(golden, null, 2)}
`

fs.writeFileSync(outPath, content, 'utf8')
console.log(`Wrote ${outPath}`)
