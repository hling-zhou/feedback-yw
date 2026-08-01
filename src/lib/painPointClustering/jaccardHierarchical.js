import { PRIMARY_CLUSTER_MAX_ITEMS } from './constants.js'
import { ensureNormalizedPainText } from './clusterSimilarity.js'
import { normalizePainPointKey } from './normalizePainPoint.js'
import {
  buildCandidatePairKeys,
  buildNeighborLists,
  buildSparseLeafSimilarities,
  pairKey,
} from './jaccardCandidatePairs.js'
import { jaccardSimilarity, tokenSetFromPainPoint } from './textTokenize.js'

/**
 * 两簇间平均链 Jaccard（全量，仅用于小 n 对照测试）
 * @param {number[]} clusterA
 * @param {number[]} clusterB
 * @param {Set<string>[]} tokenSets
 */
export function averageLinkageSimilarity(clusterA, clusterB, tokenSets) {
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
 * @template T
 * @param {{ item: T; tokens: Set<string> }[]} valid
 * @param {Set<string>[]} tokenSets
 * @param {number} threshold
 * @param {number} minSize
 * @returns {{ clusters: T[][]; isolated: T[] }}
 */
export function hierarchicalClusterValidNaive(valid, tokenSets, threshold, minSize) {
  if (!valid.length) return { clusters: [], isolated: [] }

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

  return partitionClusterMembers(valid, clusters, minSize)
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 */
function tokenSetsIntersect(a, b) {
  if (a.size > b.size) return tokenSetsIntersect(b, a)
  for (const t of a) if (b.has(t)) return true
  return false
}

/**
 * M2：倒排候选对 + NN-chain 平均链 + Lance-Williams 更新
 *
 * @template T
 * @param {{ item: T; tokens: Set<string> }[]} valid
 * @param {Set<string>[]} tokenSets
 * @param {number} threshold
 * @param {number} minSize
 * @param {{ minSharedTokens?: number; pairSimilarity?: (aIndex: number, bIndex: number) => number }} [options]
 */
function hierarchicalClusterValid(valid, tokenSets, threshold, minSize, options = {}) {
  const n = valid.length
  if (!n) return { clusters: [], isolated: [] }
  if (n === 1) return partitionClusterMembers(valid, [[0]], minSize)

  const minSharedTokens =
    options.minSharedTokens ??
    (n > 1000 ? 4 : n > 500 ? 3 : n > PRIMARY_CLUSTER_MAX_ITEMS ? 2 : 1)
  const candidatePairKeys = buildCandidatePairKeys(n, tokenSets, minSharedTokens)
  const leafSim = buildSparseLeafSimilarities(tokenSets, candidatePairKeys, options.pairSimilarity)
  const neighbors = buildNeighborLists(n, candidatePairKeys)

  /** @type {number[][]} */
  const groups = Array.from({ length: n }, (_, i) => [i])
  /** @type {number[]} */
  const sizes = Array(n).fill(1)
  /** @type {boolean[]} */
  const active = Array(n).fill(true)
  /** @type {Set<string>[]} */
  const clusterTokens = tokenSets.map((tokens) => new Set(tokens))
  let activeCount = n

  /** @type {Map<string, number>} clusterSim — 仅 token 有交集的活跃簇对 */
  const clusterSim = new Map()
  for (const key of candidatePairKeys) {
    clusterSim.set(key, leafSim.get(key) ?? 0)
  }

  /**
   * @param {number} i
   * @param {number} j
   */
  function getSim(i, j) {
    return clusterSim.get(pairKey(i, j)) ?? 0
  }

  /**
   * @param {number} i
   * @param {number} j
   * @param {number} sim
   */
  function setSim(i, j, sim) {
    if (i === j) return
    if (!tokenSetsIntersect(clusterTokens[i], clusterTokens[j])) return
    const key = pairKey(i, j)
    if (sim <= 0) {
      clusterSim.delete(key)
      neighbors[i].delete(j)
      neighbors[j].delete(i)
      return
    }
    clusterSim.set(key, sim)
    neighbors[i].add(j)
    neighbors[j].add(i)
  }

  /**
   * @param {number} i
   */
  function nearestNeighbor(i) {
    let bestSim = -1
    let bestJ = -1
    for (const j of neighbors[i]) {
      if (!active[j]) continue
      const sim = getSim(i, j)
      if (sim > bestSim) {
        bestSim = sim
        bestJ = j
      }
    }
    return { sim: bestSim, j: bestJ }
  }

  /**
   * @returns {{ sim: number; i: number; j: number }}
   */
  function findGlobalBestPair() {
    let bestSim = -1
    let bestI = -1
    let bestJ = -1
    for (let i = 0; i < n; i += 1) {
      if (!active[i]) continue
      for (const j of neighbors[i]) {
        if (j <= i || !active[j]) continue
        const sim = getSim(i, j)
        if (sim > bestSim) {
          bestSim = sim
          bestI = i
          bestJ = j
        }
      }
    }
    return { sim: bestSim, i: bestI, j: bestJ }
  }

  /**
   * @param {number} mergeI
   * @param {number} mergeJ
   */
  function mergeClusters(mergeI, mergeJ) {
    const sizeI = sizes[mergeI]
    const sizeJ = sizes[mergeJ]

    for (const t of clusterTokens[mergeJ]) clusterTokens[mergeI].add(t)

    for (let k = 0; k < n; k += 1) {
      if (!active[k] || k === mergeI || k === mergeJ) continue
      if (!tokenSetsIntersect(clusterTokens[mergeI], clusterTokens[k])) continue
      const simIk = getSim(mergeI, k)
      const simJk = getSim(mergeJ, k)
      if (simIk <= 0 && simJk <= 0) continue
      setSim(mergeI, k, (sizeI * simIk + sizeJ * simJk) / (sizeI + sizeJ))
    }

    for (const k of neighbors[mergeJ]) {
      neighbors[k].delete(mergeJ)
      clusterSim.delete(pairKey(mergeJ, k))
    }
    neighbors[mergeJ].clear()

    clusterSim.delete(pairKey(mergeI, mergeJ))
    neighbors[mergeI].delete(mergeJ)

    groups[mergeI].push(...groups[mergeJ])
    sizes[mergeI] = sizeI + sizeJ
    active[mergeJ] = false
    activeCount -= 1
  }

  /** @type {number[]} */
  let chain = []

  while (activeCount > 1) {
    if (!chain.length) {
      const { sim, i, j } = findGlobalBestPair()
      if (sim < threshold || i < 0) break
      chain.push(i)
      if (j >= 0 && j !== i) chain.push(j)
    }

    const i = chain[chain.length - 1]
    if (!active[i]) {
      chain.pop()
      continue
    }

    const { sim, j } = nearestNeighbor(i)
    if (j < 0 || !active[j] || sim < threshold) {
      chain.pop()
      continue
    }

    if (chain.length >= 2 && chain[chain.length - 2] === j) {
      mergeClusters(i, j)
      chain.pop()
      chain.pop()
      continue
    }

    if (j === i) {
      chain.pop()
      continue
    }

    chain.push(j)
  }

  /** @type {number[][]} */
  const finalGroups = groups.filter((_, idx) => active[idx])
  return partitionClusterMembers(valid, finalGroups, minSize)
}

/**
 * @template T
 * @param {{ item: T; tokens: Set<string> }[]} valid
 * @param {number[][]} memberGroups
 * @param {number} minSize
 */
function partitionClusterMembers(valid, memberGroups, minSize) {
  /** @type {T[][]} */
  const resultClusters = []
  const clustered = new Set()

  for (const memberIdxs of memberGroups) {
    if (memberIdxs.length >= minSize) {
      const group = memberIdxs.map((idx) => valid[idx].item)
      resultClusters.push(group)
      memberIdxs.forEach((idx) => clustered.add(idx))
    }
  }

  /** @type {T[]} */
  const isolated = valid.filter((_, idx) => !clustered.has(idx)).map((v) => v.item)

  return { clusters: resultClusters, isolated }
}

/**
 * M1 Layer 0：规范化后完全相同的文本直接成簇
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} getText
 */
function exactMergeByNormalizedText(items, getText) {
  /** @type {Map<string, T[]>} */
  const buckets = new Map()
  /** @type {T[]} */
  const invalid = []

  for (const item of items) {
    const raw = getText(item)?.trim() || ''
    if (raw.length < 4) {
      invalid.push(item)
      continue
    }
    const key = normalizePainPointKey(raw)
    if (key.length < 4) {
      invalid.push(item)
      continue
    }
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(item)
  }

  /** @type {T[][]} */
  const exactClusters = []
  /** @type {T[]} */
  const remainder = []

  for (const group of buckets.values()) {
    if (group.length >= 2) {
      exactClusters.push(group)
    } else {
      remainder.push(...group)
    }
  }

  return { exactClusters, remainder, invalid }
}

/**
 * 按规范化 key 聚合 unique 文本；超过上限时仅保留高频项做层次聚类（M2-3）
 *
 * @template T
 * @param {T[]} remainder
 * @param {(item: T) => string} getText
 * @returns {{ valid: { item: T; tokens: Set<string>; members: T[] }[]; cappedIsolated: T[] }}
 */
function prepareHierarchicalValid(remainder, getText, pipelineOptions = {}) {
  /** @type {Map<string, { item: T; tokens: Set<string>; members: T[]; normalizedPainText: ReturnType<typeof ensureNormalizedPainText> }>} */
  const unique = new Map()

  for (const item of remainder) {
    const text = getText(item)?.trim() || ''
    const normalizedPainText = pipelineOptions.buildNormalizedText
      ? pipelineOptions.buildNormalizedText(text, item)
      : ensureNormalizedPainText(text)
    const tokens = pipelineOptions.getTokenSet
      ? pipelineOptions.getTokenSet(text, item, normalizedPainText)
      : normalizedPainText.semanticTokens || tokenSetFromPainPoint(text)
    if (!tokens.size) continue
    const key = normalizePainPointKey(text)
    if (!unique.has(key)) {
      unique.set(key, { item, tokens, members: [item], normalizedPainText })
    } else {
      unique.get(key).members.push(item)
    }
  }

  /** @type {{ item: T; tokens: Set<string>; members: T[]; normalizedPainText: ReturnType<typeof ensureNormalizedPainText>; weight: number }[]} */
  let entries = [...unique.values()].map((entry) => ({
    ...entry,
    weight: entry.members.length,
  }))

  /** @type {T[]} */
  const cappedIsolated = []

  if (entries.length > PRIMARY_CLUSTER_MAX_ITEMS) {
    entries.sort((a, b) => b.weight - a.weight)
    const rest = entries.slice(PRIMARY_CLUSTER_MAX_ITEMS)
    entries = entries.slice(0, PRIMARY_CLUSTER_MAX_ITEMS)
    for (const entry of rest) {
      cappedIsolated.push(...entry.members)
    }
    if (import.meta.env?.DEV) {
      console.info(
        `[pain-cluster] 大组 unique=${unique.size}，层次聚类仅取 Top ${PRIMARY_CLUSTER_MAX_ITEMS} 代表文本`,
      )
    }
  }

  return {
    valid: entries.map(({ item, tokens, members, normalizedPainText }) => ({
      item,
      tokens,
      members,
      normalizedPainText,
    })),
    cappedIsolated,
  }
}

/**
 * Jaccard + 平均链层次聚类，相似度 ≥ threshold 时合并
 *
 * M1 exact 预合并 → M2 倒排 + NN-chain 平均链
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} getText
 * @param {number} threshold
 * @param {number} [minSize]
 * @param {{
 *   useNaiveHierarchical?: boolean
 *   minSharedTokens?: number
 *   buildNormalizedText?: (text: string, item: T) => ReturnType<typeof ensureNormalizedPainText>
 *   getTokenSet?: (text: string, item: T, normalizedPainText: ReturnType<typeof ensureNormalizedPainText>) => Set<string>
 *   getPairSimilarity?: (a: { item: T; tokens: Set<string>; members: T[]; normalizedPainText: ReturnType<typeof ensureNormalizedPainText> }, b: { item: T; tokens: Set<string>; members: T[]; normalizedPainText: ReturnType<typeof ensureNormalizedPainText> }) => number
 * }} [pipelineOptions]
 * @returns {{ clusters: T[][]; isolated: T[] }}
 */
export function clusterByJaccard(items, getText, threshold, minSize = 2, pipelineOptions = {}) {
  if (!items?.length) return { clusters: [], isolated: [] }

  const { exactClusters, remainder, invalid } = exactMergeByNormalizedText(items, getText)

  /** @type {T[]} */
  const invalidFromRemainder = []
  for (const item of remainder) {
    const text = getText(item)?.trim() || ''
    const normalizedPainText = pipelineOptions.buildNormalizedText
      ? pipelineOptions.buildNormalizedText(text, item)
      : ensureNormalizedPainText(text)
    const tokens = pipelineOptions.getTokenSet
      ? pipelineOptions.getTokenSet(text, item, normalizedPainText)
      : normalizedPainText.semanticTokens || tokenSetFromPainPoint(text)
    if (!tokens.size) invalidFromRemainder.push(item)
  }

  const { valid, cappedIsolated } = prepareHierarchicalValid(
    remainder.filter((item) => {
      const text = getText(item)?.trim() || ''
      const normalizedPainText = pipelineOptions.buildNormalizedText
        ? pipelineOptions.buildNormalizedText(text, item)
        : ensureNormalizedPainText(text)
      const tokens = pipelineOptions.getTokenSet
        ? pipelineOptions.getTokenSet(text, item, normalizedPainText)
        : normalizedPainText.semanticTokens || tokenSetFromPainPoint(text)
      return tokens.size > 0
    }),
    getText,
    pipelineOptions,
  )

  if (!valid.length) {
    return {
      clusters: exactClusters,
      isolated: [...invalid, ...invalidFromRemainder, ...cappedIsolated],
    }
  }

  const tokenSets = valid.map((v) => v.tokens)
  const pairSimilarity = pipelineOptions.getPairSimilarity
    ? (aIndex, bIndex) => pipelineOptions.getPairSimilarity(valid[aIndex], valid[bIndex])
    : undefined
  const { clusters: hierMemberClusters, isolated: hierIsolatedItems } = pipelineOptions.useNaiveHierarchical
    ? hierarchicalClusterValidNaive(valid, tokenSets, threshold, minSize)
    : hierarchicalClusterValid(valid, tokenSets, threshold, minSize, {
      ...pipelineOptions,
      pairSimilarity,
    })

  /** @type {Map<T, T[]>} */
  const membersByRep = new Map(valid.map((v) => [v.item, v.members]))

  /** @type {T[][]} */
  const hierClusters = hierMemberClusters.map((cluster) =>
    cluster.flatMap((rep) => membersByRep.get(rep) ?? [rep]),
  )
  /** @type {T[]} */
  const hierIsolatedExpanded = hierIsolatedItems.flatMap(
    (rep) => membersByRep.get(rep) ?? [rep],
  )

  return {
    clusters: [...exactClusters, ...hierClusters],
    isolated: [...hierIsolatedExpanded, ...invalid, ...invalidFromRemainder, ...cappedIsolated],
  }
}
