import { getNodeMapsForProduct } from '../taxonomyLoader.js'
import {
  DEFAULT_PROBLEM_TYPE_PATH_MAP,
  DEFAULT_REQUEST_SCENE_PATH_MAP,
  pendingReviewTag,
  TAG_UNRECOGNIZED,
} from './tagLabels.js'
import { resolvePathDimensionSegments } from './pathSegments.js'

/**
 * @param {string} taxonomyKey
 */
function getRequestScenePathMap(taxonomyKey) {
  const { requestSceneMap } = getNodeMapsForProduct(taxonomyKey)
  return { ...DEFAULT_REQUEST_SCENE_PATH_MAP, ...(requestSceneMap || {}) }
}

/**
 * @param {string} taxonomyKey
 */
function getProblemTypePathMap(taxonomyKey) {
  const { problemTypePathMap } = getNodeMapsForProduct(taxonomyKey)
  return { ...DEFAULT_PROBLEM_TYPE_PATH_MAP, ...(problemTypePathMap || {}) }
}

/**
 * 路径段 3 → 请求场景（精确匹配）
 * @param {string[]} segments
 * @param {string} taxonomyKey
 * @param {{ label: string }[]} requestScenes
 */
export function matchRequestSceneFromPath(segments, taxonomyKey, requestScenes) {
  const resolved = resolvePathDimensionSegments(segments)
  if (!resolved) return null

  const seg = resolved.sceneSeg?.trim()
  if (!seg) return null

  const map = getRequestScenePathMap(taxonomyKey)
  const mapped = map[seg]
  const labels = new Set((requestScenes || []).map((r) => r.label))

  if (mapped && labels.has(mapped)) return mapped
  if (labels.has(seg)) return seg
  return pendingReviewTag(seg)
}

/**
 * 路径段 4 → 问题类型（精确匹配标签名或产品/默认别名表）
 * @param {string[]} segments
 * @param {string} taxonomyKey
 * @param {{ label: string }[]} problemTypes
 */
export function matchProblemTypeFromPath(segments, taxonomyKey, problemTypes) {
  const resolved = resolvePathDimensionSegments(segments)
  if (!resolved) return null

  const seg = resolved.problemSeg?.trim()
  if (!seg) return null

  const labels = (problemTypes || []).map((p) => p.label)
  const exact = labels.find((l) => l === seg)
  if (exact) return exact

  const aliasMap = getProblemTypePathMap(taxonomyKey)
  const mapped = aliasMap[seg]
  if (mapped && labels.includes(mapped)) return mapped

  return pendingReviewTag(seg)
}

/**
 * 路径段 3/4 → 用户旅程（精确映射，复用 nodeMaps）
 * @param {string} text
 * @param {import('../productTaxonomy.js').JourneyL1[]} journeys
 * @param {string} taxonomyKey
 * @param {string[]} [pathSegments]
 */
export function matchJourneyFromPath(text, journeys, taxonomyKey, pathSegments) {
  const { serviceMap, issueMap } = getNodeMapsForProduct(taxonomyKey)

  let segments = pathSegments
  if (!segments?.length) {
    const m = (text || '').match(/(?:请求节点|系统路径)[：:]([^\n]+)/i)
    if (!m) return null
    segments = m[1]
      .split('--')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'undefined')
  }

  const resolved = resolvePathDimensionSegments(segments)
  if (!resolved) return null

  const serviceType = resolved.journeyServiceSeg || ''
  const issueType = resolved.journeyIssueSeg || ''

  let l1Id = serviceMap[serviceType] || null
  const issueHint = issueMap[issueType]
  if (issueHint) l1Id = issueHint.l1
  if (!l1Id) return null

  const l1Node = journeys.find((j) => j.id === l1Id)
  if (!l1Node) return null

  let l2Node = null
  if (issueHint?.l2) {
    l2Node = l1Node.children.find((c) => c.id === issueHint.l2)
  }

  return {
    journeyL1: l1Node.label,
    journeyL2: l2Node?.label || TAG_UNRECOGNIZED,
  }
}
