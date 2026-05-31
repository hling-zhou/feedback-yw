/**
 * 解析系统路径/请求节点分段，统一段 3（请求场景）、段 4（问题类型）索引。
 * 常见格式：undefined--{产品}--{段3}--{段4} → 去 undefined 后为 [产品, 段3, 段4]
 */

/**
 * @param {string[]} segments 已 trim、已过滤 undefined
 * @returns {{ sceneSeg: string; problemSeg: string; journeyServiceSeg: string; journeyIssueSeg: string } | null}
 */
export function resolvePathDimensionSegments(segments) {
  const segs = (segments || []).map((s) => s?.trim()).filter(Boolean)
  if (segs.length >= 3) {
    return {
      sceneSeg: segs[1],
      problemSeg: segs[2],
      journeyServiceSeg: segs[1],
      journeyIssueSeg: segs[2],
    }
  }
  if (segs.length === 2) {
    return {
      sceneSeg: segs[0],
      problemSeg: segs[1],
      journeyServiceSeg: segs[0],
      journeyIssueSeg: segs[1],
    }
  }
  return null
}
