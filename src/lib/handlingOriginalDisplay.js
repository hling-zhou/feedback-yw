/**
 * 工单原文「放大查看」展示分段：只切分、不改写正文。
 * 「复制全文」仍应使用原始完整字符串。
 */

/**
 * @typedef {'phase' | 'field' | 'plain'} HandlingOriginalSegmentKind
 */

/**
 * @typedef {Object} HandlingOriginalSegment
 * @property {HandlingOriginalSegmentKind} kind
 * @property {string} [label]
 * @property {string} text
 */

const WORKFLOW_PHASE_HEAD_RE =
  /(?:^|\n)((?:开始|首处理|协办|反馈)&[^\n]*?&处理意见[：:])/g

const LEGACY_WORKFLOW_HEAD_RE =
  /(?:^|\n)((?:开始|首处理|协办|反馈)&[^&\n：:]{1,40}[：:])/g

/** 常见字段名（用于粘连正文内切分，避免误切句中冒号） */
const KNOWN_FIELD_LABELS = [
  '客户标签',
  '请求节点',
  '详细内容',
  '联系时间',
  '客户需求',
  '客户问题',
  '产品UUID',
  '问题原因',
  '解决方案',
  '解决方案（必填）',
  '目前进展',
  '协助内容',
  '协助请求',
  '预处理',
  '处理人',
  '是否验证',
  '回单口径',
  '归档意见',
  '工单标题',
  '受理渠道',
  '产品名称',
  '处理意见',
  '根因',
  '根因（必填）',
  '回复内容',
  '咨询答复',
  '问题描述',
  '咨询内容',
  '受理内容',
  '故障现象',
  '问题现象',
  '客户反馈',
  '客户原话',
  '优化举措',
  '优化举措/建议',
].sort((a, b) => b.length - a.length)

const KNOWN_LABEL_ALT = KNOWN_FIELD_LABELS.map(escapeRegExp).join('|')

/**
 * 字段起点：编号 + 【标签】/已知标签 + 冒号（允许粘连无换行）
 * @type {RegExp}
 */
const FIELD_START_RE = new RegExp(
  `(?:(\\d+)[、.．]\\s*)?(?:【(${KNOWN_LABEL_ALT}|[^】]{1,40})】|(${KNOWN_LABEL_ALT}))\\s*[：:]`,
  'g',
)

/**
 * @param {string} value
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {string} text
 * @param {RegExp} headRe
 * @returns {{ index: number; head: string }[]}
 */
function collectHeads(text, headRe) {
  /** @type {{ index: number; head: string }[]} */
  const heads = []
  const re = new RegExp(headRe.source, headRe.flags)
  let m = re.exec(text)
  while (m) {
    const head = m[1]
    const index = m.index + (m[0].startsWith('\n') ? 1 : 0)
    heads.push({ index, head })
    m = re.exec(text)
  }
  return heads
}

/**
 * @param {string} head
 */
function phaseLabelFromHead(head) {
  const trimmed = head.trim()
  const cut = trimmed.search(/&处理意见[：:]/)
  if (cut > 0) return trimmed.slice(0, cut)
  return trimmed.replace(/[：:]\s*$/, '')
}

/**
 * @param {string} text
 * @returns {{ label: string | null; body: string; kind: 'phase' | 'plain' }[]}
 */
function splitWorkflowPhases(text) {
  let heads = collectHeads(text, WORKFLOW_PHASE_HEAD_RE)
  if (heads.length < 2) {
    const legacy = collectHeads(text, LEGACY_WORKFLOW_HEAD_RE)
    if (legacy.length >= 2) heads = legacy
  }

  if (heads.length < 2) {
    return [{ label: null, body: text, kind: 'plain' }]
  }

  /** @type {{ label: string | null; body: string; kind: 'phase' | 'plain' }[]} */
  const phases = []
  if (heads[0].index > 0) {
    const lead = text.slice(0, heads[0].index)
    if (lead.trim()) phases.push({ label: null, body: lead, kind: 'plain' })
  }

  for (let i = 0; i < heads.length; i += 1) {
    const start = heads[i].index
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length
    const chunk = text.slice(start, end)
    const head = heads[i].head
    let body = chunk.startsWith(head) ? chunk.slice(head.length) : chunk
    // 阶段之间的换行留在上一段末尾；下一段正文去掉开头换行以免空白块
    if (body.startsWith('\n')) body = body.slice(1)
    phases.push({
      label: phaseLabelFromHead(head),
      body,
      kind: 'phase',
    })
  }
  return phases
}

/**
 * @param {string} text
 * @returns {{ index: number; end: number; label: string }[]}
 */
function findFieldMarks(text) {
  /** @type {{ index: number; end: number; label: string }[]} */
  const marks = []
  const re = new RegExp(FIELD_START_RE.source, FIELD_START_RE.flags)
  let m = re.exec(text)
  while (m) {
    const num = m[1]
    const bracketLabel = m[2]
    const bareLabel = m[3]
    const labelCore = (bracketLabel || bareLabel || '').trim()
    if (!labelCore) {
      m = re.exec(text)
      continue
    }
    const label = num ? `${num}、${labelCore}` : labelCore
    marks.push({ index: m.index, end: m.index + m[0].length, label })
    m = re.exec(text)
  }
  return marks
}

/**
 * @param {string} text
 * @returns {{ label: string | null; text: string }[]}
 */
function splitFields(text) {
  if (!text) return []
  const marks = findFieldMarks(text)
  if (!marks.length) {
    return text.trim() ? [{ label: null, text }] : []
  }

  /** @type {{ label: string | null; text: string }[]} */
  const fields = []
  if (marks[0].index > 0) {
    const lead = text.slice(0, marks[0].index)
    if (lead.trim()) fields.push({ label: null, text: lead })
  }

  for (let i = 0; i < marks.length; i += 1) {
    const valueStart = marks[i].end
    const valueEnd = i + 1 < marks.length ? marks[i + 1].index : text.length
    fields.push({
      label: marks[i].label,
      text: text.slice(valueStart, valueEnd),
    })
  }
  return fields
}

/**
 * @param {{ label: string | null; text: string }} field
 * @returns {HandlingOriginalSegment}
 */
function toSegment(field) {
  if (field.label) {
    return { kind: 'field', label: field.label, text: field.text }
  }
  return { kind: 'plain', text: field.text }
}

/**
 * 是否值得用结构化展示（否则 UI 回退整段 pre-wrap）。
 *
 * @param {HandlingOriginalSegment[]} segments
 */
export function shouldUseStructuredHandlingDisplay(segments) {
  if (!segments?.length) return false
  if (segments.length === 1) {
    const only = segments[0]
    return only.kind === 'phase' || (only.kind === 'field' && Boolean(only.label))
  }
  return true
}

/**
 * @typedef {Object} HandlingOriginalPhaseGroup
 * @property {string} id
 * @property {string} label
 * @property {HandlingOriginalSegment[]} items
 */

const LEAD_BODY_GROUP_LABEL = '正文'

/**
 * 将扁平分段按流转阶段成组，供折叠面板 / 目录使用。
 *
 * @param {HandlingOriginalSegment[]} segments
 * @returns {HandlingOriginalPhaseGroup[]}
 */
export function groupHandlingOriginalByPhase(segments) {
  if (!segments?.length) return []

  /** @type {HandlingOriginalPhaseGroup[]} */
  const groups = []
  /** @type {HandlingOriginalPhaseGroup | null} */
  let current = null
  let phaseIndex = 0

  const ensureLeadGroup = () => {
    if (current) return
    current = {
      id: 'lead-body',
      label: LEAD_BODY_GROUP_LABEL,
      items: [],
    }
    groups.push(current)
  }

  for (const seg of segments) {
    if (seg.kind === 'phase') {
      phaseIndex += 1
      current = {
        id: `phase-${phaseIndex}`,
        label: seg.label?.trim() || `阶段 ${phaseIndex}`,
        items: [],
      }
      if (seg.text) {
        current.items.push({ kind: 'plain', text: seg.text })
      }
      groups.push(current)
      continue
    }
    ensureLeadGroup()
    current.items.push(seg)
  }

  return groups
}

/**
 * 默认展开：少于 5 组全开；≥5 组仅首尾。
 *
 * @param {HandlingOriginalPhaseGroup[]} groups
 * @returns {string[]}
 */
export function defaultExpandedPhaseIds(groups) {
  if (!groups?.length) return []
  if (groups.length < 5) return groups.map((g) => g.id)
  return [groups[0].id, groups[groups.length - 1].id]
}

/**
 * 统计关键字在一组内的命中次数（标签 + 正文，大小写不敏感）。
 *
 * @param {HandlingOriginalPhaseGroup} group
 * @param {string} keyword
 */
export function countHandlingKeywordHitsInGroup(group, keyword) {
  const needle = String(keyword ?? '').trim().toLowerCase()
  if (!needle || !group) return 0
  let hits = 0
  const groupLabel = String(group.label ?? '').toLowerCase()
  if (groupLabel.includes(needle)) hits += 1
  for (const item of group.items || []) {
    const label = String(item.label ?? '').toLowerCase()
    const text = String(item.text ?? '').toLowerCase()
    if (label.includes(needle)) hits += 1
    if (text.includes(needle)) hits += 1
  }
  return hits
}

/**
 * @param {HandlingOriginalPhaseGroup[]} groups
 * @param {string} keyword
 * @returns {string[]}
 */
export function phaseIdsMatchingKeyword(groups, keyword) {
  const needle = String(keyword ?? '').trim()
  if (!needle) return []
  return (groups || [])
    .filter((group) => countHandlingKeywordHitsInGroup(group, needle) > 0)
    .map((group) => group.id)
}

/**
 * @typedef {{ start: number; end: number }} TextOffsetRange
 */

/**
 * 合并重叠/相邻的高亮区间（不改写正文）。
 *
 * @param {TextOffsetRange[]} ranges
 * @returns {TextOffsetRange[]}
 */
export function mergeHighlightRanges(ranges) {
  const normalized = (ranges || [])
    .map((r) => ({
      start: Math.max(0, Number(r?.start) || 0),
      end: Math.max(0, Number(r?.end) || 0),
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)

  /** @type {TextOffsetRange[]} */
  const merged = []
  for (const range of normalized) {
    const last = merged[merged.length - 1]
    if (!last || range.start > last.end) {
      merged.push({ ...range })
      continue
    }
    last.end = Math.max(last.end, range.end)
  }
  return merged
}

/**
 * @typedef {{ text: string; manual: boolean }} ManualHighlightSlice
 */

/**
 * 按手动高亮区间切片正文（子串仍来自原文）。
 *
 * @param {string} text
 * @param {TextOffsetRange[]} ranges
 * @returns {ManualHighlightSlice[]}
 */
export function splitTextWithManualHighlights(text, ranges) {
  const value = String(text ?? '')
  if (!value) return []
  const merged = mergeHighlightRanges(
    (ranges || []).map((r) => ({
      start: Math.min(value.length, Math.max(0, r.start)),
      end: Math.min(value.length, Math.max(0, r.end)),
    })),
  )
  if (!merged.length) return [{ text: value, manual: false }]

  /** @type {ManualHighlightSlice[]} */
  const slices = []
  let pos = 0
  for (const range of merged) {
    if (range.start > pos) {
      slices.push({ text: value.slice(pos, range.start), manual: false })
    }
    slices.push({ text: value.slice(range.start, range.end), manual: true })
    pos = range.end
  }
  if (pos < value.length) {
    slices.push({ text: value.slice(pos), manual: false })
  }
  return slices
}

/**
 * 将工单原文切成展示用分段。不改写正文子串。
 *
 * @param {string} text
 * @returns {HandlingOriginalSegment[]}
 */
export function segmentHandlingOriginalText(text) {
  const raw = String(text ?? '')
  if (!raw.trim()) return []

  const phases = splitWorkflowPhases(raw)
  /** @type {HandlingOriginalSegment[]} */
  const segments = []

  for (const phase of phases) {
    const fields = splitFields(phase.body)
    if (phase.kind === 'phase' && phase.label) {
      if (fields.length === 0) {
        segments.push({ kind: 'phase', label: phase.label, text: '' })
        continue
      }
      if (fields.length === 1 && !fields[0].label) {
        segments.push({ kind: 'phase', label: phase.label, text: fields[0].text })
        continue
      }
      segments.push({ kind: 'phase', label: phase.label, text: '' })
      for (const field of fields) {
        if (field.label && !String(field.text).trim()) continue
        segments.push(toSegment(field))
      }
      continue
    }

    if (fields.length === 0) continue
    if (fields.length === 1 && !fields[0].label) {
      segments.push({ kind: 'plain', text: fields[0].text })
      continue
    }
    for (const field of fields) {
      if (field.label && !String(field.text).trim()) continue
      segments.push(toSegment(field))
    }
  }

  if (!shouldUseStructuredHandlingDisplay(segments)) {
    return [{ kind: 'plain', text: raw }]
  }
  return segments
}
