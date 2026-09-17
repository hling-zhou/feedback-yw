/**
 * 解析系统路径/请求节点分段，统一段 3（请求场景）、段 4（问题类型）索引。
 * 常见格式：undefined--{产品}--{段3}--{段4} → 去 undefined 后为 [产品, 段3, 段4]
 */

/**
 * 「请求节点 / 系统路径」值之后紧跟的模板字段名。
 *
 * 真实工单把节点值与后续字段堆在**同一行**且**无分隔符**：
 *   `请求节点：VPC--VPC业务变更工单标题：VPC业务变更详细内容：…联系时间：9:00 — 18:00`
 * 若只按 `[^\n]+` 取行尾，末段会变成整段正文 —— issueMap 精确匹配永不命中
 * （表现为 journeyL2 恒为「无法识别」），维度兜底还会把整段原文塞进「待复核标签/…」。
 */
const PATH_TAIL_FIELD_RE =
  /(?:工单标题|详细内容|##?产品名称|联系时间|受理渠道|客户标签|问题原因)/

/**
 * 解析「请求节点 / 系统路径」行 → 分段。
 * 先在模板字段名处截断，再按 `--` 切分、trim、剔除 `undefined`。
 * @param {string} text
 * @returns {{ raw: string; segments: string[] }}
 */
export function parseRequestNodeSegments(text) {
  const m = String(text || '').match(/(?:请求节点|系统路径)[：:]\s*([^\n]+)/i)
  if (!m) return { raw: '', segments: [] }
  const raw = m[1].split(PATH_TAIL_FIELD_RE)[0].trim()
  const segments = raw
    .split('--')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'undefined')
  return { raw, segments }
}

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
