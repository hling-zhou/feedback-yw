import { jaccardSimilarity, tokenSetFromPainPoint } from './textTokenize.js'

/**
 * 两簇间平均链 Jaccard 相似度
 * @param {number[]} clusterA
 * @param {number[]} clusterB
 * @param {Set<string>[]} tokenSets
 */
function averageLinkageSimilarity(clusterA, clusterB, tokenSets) {
  if (!clusterA.length || !clusterB.length) return 0
  let sum = 0
  for (const i of clusterA) {
    for (const j of clusterB) {
      sum += jaccardSimilarity(tokenSets[i], tokenSets[j])
    }
  }
  return sum / (clusterA.length * clusterB.length)
}

/**
 * Jaccard + 平均链层次聚类，相似度 ≥ threshold 时合并
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} getText
 * @param {number} threshold
 * @param {number} [minSize]
 * @returns {{ clusters: T[][]; isolated: T[] }}
 */
export function clusterByJaccard(items, getText, threshold, minSize = 2) {
  if (!items?.length) return { clusters: [], isolated: [] }

  /** @type {{ item: T; tokens: Set<string> }[]} */
  const valid = []
  /** @type {T[]} */
  const invalid = []

  for (const item of items) {
    const text = getText(item)?.trim() || ''
    if (text.length < 4) {
      invalid.push(item)
      continue
    }
    const tokens = tokenSetFromPainPoint(text)
    if (!tokens.size) {
      invalid.push(item)
      continue
    }
    valid.push({ item, tokens })
  }

  if (!valid.length) return { clusters: [], isolated: invalid }

  const tokenSets = valid.map((v) => v.tokens)
  /** @type {number[][]} */
  let clusters = valid.map((_, i) => [i])

  while (clusters.length > 1) {
    let bestSim = -1
    let mergeI = -1
    let mergeJ = -1

    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const sim = averageLinkageSimilarity(clusters[i], clusters[j], tokenSets)
        if (sim > bestSim) {
          bestSim = sim
          mergeI = i
          mergeJ = j
        }
      }
    }

    if (bestSim < threshold || mergeI < 0) break

    const merged = [...clusters[mergeI], ...clusters[mergeJ]]
    clusters = clusters.filter((_, idx) => idx !== mergeI && idx !== mergeJ)
    clusters.push(merged)
  }

  /** @type {T[][]} */
  const resultClusters = []
  const clustered = new Set()

  for (const memberIdxs of clusters) {
    if (memberIdxs.length >= minSize) {
      const group = memberIdxs.map((idx) => valid[idx].item)
      resultClusters.push(group)
      memberIdxs.forEach((idx) => clustered.add(idx))
    }
  }

  /** @type {T[]} */
  const isolated = [
    ...valid.filter((_, idx) => !clustered.has(idx)).map((v) => v.item),
    ...invalid,
  ]

  return { clusters: resultClusters, isolated }
}
