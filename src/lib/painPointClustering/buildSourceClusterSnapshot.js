import { CLUSTERING_VERSION } from './constants.js'
import { runPrimaryClustering } from './primaryCluster.js'
import { listClusteringProducts } from './runProductClusteringPipeline.js'

/**
 * @typedef {import('./primaryCluster.js').PrimaryPainCluster} PrimaryPainCluster
 */

/**
 * @typedef {Object} ProductPrimaryClusterSnapshot
 * @property {PrimaryPainCluster[]} primaryClusters
 * @property {string[]} isolatedRecordIds
 */

/**
 * @typedef {Object} SourcePainPointClusterSnapshot
 * @property {string} clusteringVersion
 * @property {Record<string, ProductPrimaryClusterSnapshot>} products
 */

/**
 * 数据来源快照：按产品存储一次聚类结果（周期 + 来源全量）
 *
 * @param {import('../types.js').FeedbackRecord[]} records
 * @returns {SourcePainPointClusterSnapshot}
 */
export function buildSourcePainPointClusterSnapshot(records) {
  if (!records?.length) {
    return { clusteringVersion: CLUSTERING_VERSION, products: {} }
  }

  /** @type {Record<string, ProductPrimaryClusterSnapshot>} */
  const products = {}

  for (const product of listClusteringProducts(records)) {
    const { primaryClusters, isolatedRecords } = runPrimaryClustering(records, product)
    products[product] = {
      primaryClusters,
      isolatedRecordIds: isolatedRecords.map((r) => r.id),
    }
  }

  return {
    clusteringVersion: CLUSTERING_VERSION,
    products,
  }
}
