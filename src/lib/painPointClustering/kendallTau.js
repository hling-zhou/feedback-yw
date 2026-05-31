/** M2-4：Top10 排序与 golden 对比的 Kendall τ 下限 */
export const CLUSTERING_TOP10_TAU_MIN = 0.85

/**
 * 两路 Top10 排名（按 cluster fingerprint）的 Kendall τ。
 * 仅在两列表交集上计算；n&lt;2 时 τ=1（无对可比较）。
 *
 * @param {string[]} referenceOrder golden 顺序（优先级高在前）
 * @param {string[]} currentOrder 当前顺序
 * @returns {{ tau: number; comparablePairs: number; intersectionSize: number; intersection: string[] }}
 */
export function kendallTauBetweenRankings(referenceOrder, currentOrder) {
  const currentSet = new Set(currentOrder)
  const intersection = referenceOrder.filter((key) => currentSet.has(key))
  const n = intersection.length

  if (n < 2) {
    return {
      tau: n === 1 ? 1 : 0,
      comparablePairs: 0,
      intersectionSize: n,
      intersection,
    }
  }

  const rankRef = new Map(referenceOrder.map((key, index) => [key, index]))
  const rankCur = new Map(currentOrder.map((key, index) => [key, index]))

  let concordant = 0
  let discordant = 0
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = intersection[i]
      const b = intersection[j]
      const refDiff = rankRef.get(a) - rankRef.get(b)
      const curDiff = rankCur.get(a) - rankCur.get(b)
      if (refDiff * curDiff > 0) concordant += 1
      else if (refDiff * curDiff < 0) discordant += 1
    }
  }

  const comparablePairs = (n * (n - 1)) / 2
  const tau = comparablePairs ? (concordant - discordant) / comparablePairs : 1

  return { tau, comparablePairs, intersectionSize: n, intersection }
}

/**
 * @param {number} tau
 * @param {number} [minTau]
 */
export function meetsClusteringTop10Tau(tau, minTau = CLUSTERING_TOP10_TAU_MIN) {
  return tau >= minTau
}
