import { jaccardSimilarity } from './textTokenize.js'

/**
 * @param {number} i
 * @param {number} j
 */
export function pairKey(i, j) {
  return i < j ? `${i}:${j}` : `${j}:${i}`
}

/**
 * 倒排索引：共享 ≥ minSharedTokens 个 token 的文本对才计算 Jaccard（M2）
 *
 * @param {number} n
 * @param {Set<string>[]} tokenSets
 * @param {number} [minSharedTokens]
 * @returns {Set<string>}
 */
export function buildCandidatePairKeys(n, tokenSets, minSharedTokens = 1) {
  /** @type {Map<string, number[]>} */
  const inverted = new Map()

  for (let i = 0; i < n; i += 1) {
    for (const token of tokenSets[i]) {
      if (!inverted.has(token)) inverted.set(token, [])
      inverted.get(token).push(i)
    }
  }

  if (minSharedTokens <= 1) {
    /** @type {Set<string>} */
    const pairs = new Set()
    for (const indices of inverted.values()) {
      if (indices.length < 2) continue
      for (let a = 0; a < indices.length; a += 1) {
        for (let b = a + 1; b < indices.length; b += 1) {
          pairs.add(pairKey(indices[a], indices[b]))
        }
      }
    }
    return pairs
  }

  /** @type {Map<string, number>} */
  const sharedCounts = new Map()
  for (const indices of inverted.values()) {
    if (indices.length < 2) continue
    for (let a = 0; a < indices.length; a += 1) {
      for (let b = a + 1; b < indices.length; b += 1) {
        const key = pairKey(indices[a], indices[b])
        sharedCounts.set(key, (sharedCounts.get(key) ?? 0) + 1)
      }
    }
  }

  /** @type {Set<string>} */
  const pairs = new Set()
  for (const [key, count] of sharedCounts.entries()) {
    if (count >= minSharedTokens) pairs.add(key)
  }
  return pairs
}

/**
 * @param {number} n
 * @param {Set<string>} candidatePairKeys
 * @returns {Set<number>[]}
 */
export function buildNeighborLists(n, candidatePairKeys) {
  /** @type {Set<number>[]} */
  const neighbors = Array.from({ length: n }, () => new Set())
  for (const key of candidatePairKeys) {
    const [a, b] = key.split(':').map(Number)
    neighbors[a].add(b)
    neighbors[b].add(a)
  }
  return neighbors
}

/**
 * @param {Set<string>[]} tokenSets
 * @param {Set<string>} candidatePairKeys
 * @param {(aIndex: number, bIndex: number) => number} [getPairSimilarity]
 * @returns {Map<string, number>}
 */
export function buildSparseLeafSimilarities(tokenSets, candidatePairKeys, getPairSimilarity) {
  /** @type {Map<string, number>} */
  const sims = new Map()
  for (const key of candidatePairKeys) {
    const [a, b] = key.split(':').map(Number)
    sims.set(
      key,
      getPairSimilarity
        ? getPairSimilarity(a, b)
        : jaccardSimilarity(tokenSets[a], tokenSets[b]),
    )
  }
  return sims
}
