import {
  extractAcceptanceTextFromFields,
  extractAppendTextForDisplay,
  extractHandlingTextFromFields,
  parseBracketSections,
} from './taggingText.js'

/**
 * @typedef {Object} TicketDetailSourceFields
 * @property {string} [handlingText]
 * @property {string} [rawText]
 * @property {string} [customerQuote]
 * @property {string} [responseText]
 * @property {string} [solutionSummary]
 * @property {Record<string, string>} [sourceColumns]
 */

/**
 * @typedef {{ label: string | null; text: string; phase?: 'initial' | 'append'; seq?: number }} TicketDetailSegment
 */

/** 语义上属于「客户诉求」的标签 */
const CUSTOMER_REQUEST_LABELS = new Set([
  '工单标题',
  '客户需求',
  '客户问题',
  '详细内容',
  '问题描述',
  '客户反馈',
  '咨询内容',
  '受理内容',
  '问题现象',
  '故障现象',
  '客户原话',
  '用户问题',
])

/** 语义上属于「平台解决方案 / 处理动作」的标签 */
const PLATFORM_SOLUTION_LABELS = new Set([
  '处理意见',
  '解决方案',
  '解决方案（必填）',
  '归档意见',
  '根因',
  '根因（必填）',
  '移动云投诉根因',
  '协查结果',
  '排查结论',
  '处理过程',
  '回复内容',
  '咨询答复',
])

/** 可能记载「客户侧处理结果」的标签（需再校验正文） */
const CUSTOMER_OUTCOME_LABELS = new Set([
  '处理结果',
  '客户确认',
  '客户反馈结果',
  '验证结果',
  '复测结果',
  '客户侧结果',
  '回访结果',
])

const CUSTOMER_DEMAND_HINT =
  /(?:无法|不能|报错|失败|希望|需要|咨询|申请|加急|投诉|故障|不通|异常|打不开|慢|丢包|绑定|开通|退订|升降配|请问|如何|怎么|为什么|帮忙)/

const PLATFORM_ACTION_HINT =
  /^(?:已协助|已为您|已处理|已开通|已配置|已调整|已修复|已返单|经排查|定位为|建议客户|请您|工程师|后台|平台侧|我侧|处理完成|复测通过|放行|关闭|重启|建群处理|请网络组|请安全组)/

const CUSTOMER_OUTCOME_CONTENT_HINT =
  /(?:客户|用户)(?:确认|反馈|侧|复测|验证|测试|试用)[^\n。]{0,120}?(?:已恢复|已解决|恢复正常|无异常|通过|正常|业务恢复|可以访问|问题消除|无异议|满意)|(?:复测|验证|测试)(?:已)?(?:通过|正常|成功)|客户侧[^\n。]{0,40}?(?:正常|通过|恢复)/g

/** 工单「追加信息」中的占位/无实质诉求表述，不应作为客户请求展示 */
const MEANINGLESS_CUSTOMER_TEXT_RE =
  /^(?:无|不涉及|无\/不涉及|无追加|暂无|无。?|N\/A|NA|—|-|\/|\.{1,3}|null|none|不涉及。?)$/i

/**
 * @param {string} text
 */
export function isMeaninglessCustomerText(text) {
  const t = (text || '').trim()
  if (!t) return true
  if (MEANINGLESS_CUSTOMER_TEXT_RE.test(t)) return true
  if (t.length <= 24 && /^(?:无|不涉及)(?:[、,，/／\s]+(?:无|不涉及))*[。.]?$/.test(t)) return true
  if (/^【[^】]{1,24}】\s*$/.test(t)) return true
  return false
}

/**
 * @param {string} text
 */
function normalizeKey(text) {
  return (text || '').replace(/\s+/g, '').trim().slice(0, 240)
}

/**
 * @param {string} label
 */
function normalizeLabel(label) {
  return (label || '').replace(/[（(].*[）)]/g, '').trim()
}

/**
 * @param {string} label
 */
function isCustomerRequestLabel(label) {
  const n = normalizeLabel(label)
  if (CUSTOMER_REQUEST_LABELS.has(n)) return true
  return /^客户|^用户|问题|故障|咨询/.test(n) && !PLATFORM_SOLUTION_LABELS.has(n)
}

/**
 * @param {string} label
 */
function isPlatformSolutionLabel(label) {
  const n = normalizeLabel(label)
  return PLATFORM_SOLUTION_LABELS.has(n) || /^处理意见|^解决方案|^根因|^归档/.test(n)
}

/**
 * @param {string} label
 */
function isCustomerOutcomeLabel(label) {
  const n = normalizeLabel(label)
  return CUSTOMER_OUTCOME_LABELS.has(n) || /^客户确认|^复测|^验证结果/.test(n)
}

/**
 * @param {string} text
 */
export function isPlatformActionContent(text) {
  const t = (text || '').trim()
  if (!t) return false
  if (PLATFORM_ACTION_HINT.test(t)) return true
  if (/经排查|定位为|根因[是为]|已协助|已返单|建群|抓包|返单/.test(t)) return true
  if (/(?:^|\n)\s*处理意见\s*[:：]|(?:^|\n)\s*【处理意见】|&处理意见\s*[:：]/.test(t)) {
    return true
  }
  if (/(?:^|\n)\s*解决方案\s*[:：]|(?:^|\n)\s*【解决方案】/.test(t)) return true
  return false
}

/** customerQuote 内嵌的平台侧结构化小节起始（用于截取客户段） */
const QUOTE_PLATFORM_SECTION_START =
  /(?:^|\n|\d+[、.．]\s*)【?(?:问题原因|目前进展|协助内容|解决方案|处理意见|处理人|是否验证|回单口径|归档意见)/

const QUOTE_CUSTOMER_BRACKET_RE =
  /【(?:客户问题|客户需求|详细内容|问题描述|咨询内容|客户反馈|客户咨询)】\s*[:：]\s*([\s\S]*?)(?=\d+[、.．]\s*【|(?:^|\n)\s*【(?:问题原因|目前进展|协助|解决方案|处理意见)|$)/i

const NUMBERED_CUSTOMER_QUESTION_RE =
  /(?:^|\n)\s*\d+[、.．]\s*【?客户(?:问题|需求)】?\s*[:：]\s*([\s\S]*?)(?=\d+[、.．]\s*(?:【?(?:问题原因|产品|目前进展|预处理|协助|解决方案)|产品UUID|预处理|协助)|$)/i

const INLINE_DETAIL_CONTENT_RE =
  /详细内容\s*[:：]\s*([\s\S]*?)(?=联系时间\s*[:：]|问题原因\s*[:：]|受理渠道\s*[:：]|请求节点\s*[:：]|客户标签\s*[:：]|工单标题\s*[:：]|【处理意见】|$)/i

/**
 * 从可能被截断、混入平台结构化字段的 customerQuote / 受理正文中提取客户诉求正文。
 *
 * @param {string} quote
 * @param {TicketDetailSourceFields} [fields]
 */
export function resolveDisplayCustomerQuote(quote, fields) {
  const trimmed = quote?.trim()
  if (!trimmed) return ''

  const bracket = trimmed.match(QUOTE_CUSTOMER_BRACKET_RE)
  if (bracket?.[1]?.trim() && !isMeaninglessCustomerText(bracket[1])) {
    return bracket[1].trim()
  }

  const numbered = trimmed.match(NUMBERED_CUSTOMER_QUESTION_RE)
  if (numbered?.[1]?.trim() && !isMeaninglessCustomerText(numbered[1])) {
    return numbered[1].trim()
  }

  /** @type {string[]} */
  const labeledParts = []
  const seenPart = new Set()
  for (const block of parseLabelValueBlocks(trimmed)) {
    if (!block.label || !isCustomerRequestLabel(block.label)) continue
    const body = block.text?.trim()
    if (!body || isMeaninglessCustomerText(body) || isPlatformActionContent(body)) continue
    const key = normalizeKey(body)
    if (seenPart.has(key)) continue
    seenPart.add(key)
    labeledParts.push(body)
  }
  if (labeledParts.length) return labeledParts.join('\n\n')

  const cut = trimmed.search(QUOTE_PLATFORM_SECTION_START)
  if (cut > 24) {
    const head = trimmed.slice(0, cut).replace(/^【[^】]+】\s*[:：]\s*/, '').trim()
    if (head && !isMeaninglessCustomerText(head) && !isPlatformActionContent(head)) {
      return head
    }
  }

  if (!isMeaninglessCustomerText(trimmed) && !isPlatformActionContent(trimmed)) {
    return trimmed
  }

  const corpora = [
    extractAcceptanceTextFromFields(fields || {}),
    fields?.rawText?.trim() || '',
  ].filter(Boolean)
  for (const corpus of corpora) {
    const detail = corpus.match(INLINE_DETAIL_CONTENT_RE)
    if (detail?.[1]?.trim() && !isMeaninglessCustomerText(detail[1])) {
      return detail[1].trim()
    }
  }

  return ''
}

/**
 * @param {string} text
 */
function isCustomerDemandContent(text) {
  const t = (text || '').trim()
  if (!t || t.length < 2) return false
  if (isPlatformActionContent(t)) return false
  if (CUSTOMER_DEMAND_HINT.test(t)) return true
  if (/客户|用户/.test(t) && !/已协助|已处理|经排查/.test(t)) return true
  return t.length <= 120 && !isPlatformActionContent(t)
}

/**
 * @param {string} text
 */
function isCustomerOutcomeContent(text) {
  const t = (text || '').trim()
  if (!t || isPlatformActionContent(t)) return false
  return CUSTOMER_OUTCOME_CONTENT_HINT.test(t)
}

/**
 * @param {string} text
 * @returns {{ label: string | null; text: string }[]}
 */
export function parseLabelValueBlocks(text) {
  if (!text?.trim()) return []
  /** @type {{ label: string | null; text: string }[]} */
  const blocks = []
  /** @type {{ label: string | null; text: string } | null} */
  let current = null

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^([^：:\n]{2,32}?)[：:]\s*(.*)$/)
    if (m) {
      if (current?.text?.trim()) blocks.push(current)
      current = { label: m[1].trim(), text: m[2].trim() }
    } else if (current) {
      current.text = `${current.text}\n${trimmed}`
    } else {
      blocks.push({ label: null, text: trimmed })
    }
  }
  if (current?.text?.trim()) blocks.push(current)
  return blocks
}

/**
 * @param {string} text
 * @returns {{ label: string | null; text: string }[]}
 */
function collectBlocksFromCorpus(text) {
  if (!text?.trim()) return []
  /** @type {Map<string, { label: string | null; text: string }>} */
  const map = new Map()

  const add = (label, body) => {
    const t = body?.trim()
    if (!t) return
    const key = `${label || ''}\0${normalizeKey(t)}`
    if (!map.has(key)) map.set(key, { label, text: t })
  }

  for (const block of parseLabelValueBlocks(text)) {
    add(block.label, block.text)
  }

  for (const [sectionLabel, sectionBody] of Object.entries(parseBracketSections(text))) {
    add(sectionLabel, sectionBody)
  }

  return [...map.values()]
}

/**
 * @param {TicketDetailSegment[]} segments
 * @param {Set<string>} seen
 * @param {TicketDetailSegment} item
 */
function pushUnique(segments, seen, item) {
  const text = item.text?.trim()
  if (!text || text.length < 2 || isMeaninglessCustomerText(text)) return
  const key = normalizeKey(text)
  if (seen.has(key)) return
  seen.add(key)
  segments.push(item)
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function parseSegmentTimestamp(text) {
  const m = (text || '').match(
    /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/,
  )
  if (!m) return null
  const normalized = m[1]
    .replace(/年|月/g, '-')
    .replace(/日/g, '')
    .replace(/-+/g, '-')
  const ts = Date.parse(normalized)
  return Number.isNaN(ts) ? null : ts
}

/**
 * 初次诉求在上，追加诉求按时间（文内时间戳或原文顺序）排列。
 *
 * @param {TicketDetailSegment[]} segments
 */
export function sortCustomerRequestSegments(segments) {
  return [...segments].sort((a, b) => {
    const phaseA = a.phase === 'append' ? 1 : 0
    const phaseB = b.phase === 'append' ? 1 : 0
    if (phaseA !== phaseB) return phaseA - phaseB
    const timeA = parseSegmentTimestamp(a.text)
    const timeB = parseSegmentTimestamp(b.text)
    if (timeA != null && timeB != null && timeA !== timeB) return timeA - timeB
    return (a.seq ?? 0) - (b.seq ?? 0)
  })
}

/**
 * 初次诉求语料：受理正文，去掉追加信息块及与 handling 字段完全重复的尾部。
 *
 * @param {TicketDetailSourceFields} fields
 */
function acceptanceCorpusForInitialRequests(fields) {
  let text = fields.rawText?.trim() || ''
  if (!text) return extractAcceptanceTextFromFields(fields)

  text = text
    .replace(/【追加信息】[\s\S]*?(?=【[^】]+】|$)/g, '')
    .replace(/【追加内容】[\s\S]*?(?=【[^】]+】|$)/g, '')
    .trim()

  const handlingBody = extractHandlingTextFromFields(fields)
  if (handlingBody && normalizeKey(text) === normalizeKey(handlingBody)) {
    return ''
  }
  if (handlingBody && text.endsWith(handlingBody)) {
    text = text.slice(0, -handlingBody.length).trim()
  }
  return text || extractAcceptanceTextFromFields(fields)
}

/**
 * @param {string} haystack
 * @param {string} needle
 */
function corpusIncludesText(haystack, needle) {
  const h = normalizeKey(haystack)
  const n = normalizeKey(needle)
  if (!h || !n) return false
  return h.includes(n) || n.includes(h)
}

/**
 * @param {TicketDetailSourceFields} fields
 * @param {string} storedQuote
 * @returns {TicketDetailSegment[]}
 */
function customerRequestSegmentsFromQuote(fields, storedQuote) {
  /** @type {TicketDetailSegment[]} */
  const segments = [
    {
      label: '客户原话',
      text: storedQuote,
      phase: 'initial',
      seq: 0,
    },
  ]
  const seen = new Set([normalizeKey(storedQuote)])

  const append = extractAppendTextForDisplay(fields)
  if (append && !isMeaninglessCustomerText(append) && !corpusIncludesText(storedQuote, append)) {
    const parts = append
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p && !isMeaninglessCustomerText(p) && isCustomerDemandContent(p))
    let appendIdx = 0
    parts.forEach((part) => {
      if (corpusIncludesText(storedQuote, part)) return
      if (isPlatformActionContent(part)) return
      appendIdx += 1
      pushUnique(segments, seen, {
        label: parts.length > 1 ? `追加诉求 ${appendIdx}` : '追加诉求',
        text: part,
        phase: 'append',
        seq: appendIdx,
      })
    })
  }

  return sortCustomerRequestSegments(segments)
}

/**
 * 客户请求：以分析规则产出的 customerQuote 为主；无原话时再从受理/咨询正文解析。
 * 仅保留客户侧诉求（含追加诉求），不含平台处理方案。
 *
 * @param {TicketDetailSourceFields} fields
 * @returns {TicketDetailSegment[]}
 */
export function extractCustomerRequestSegments(fields) {
  const storedQuote = fields.customerQuote?.trim()
  if (storedQuote) {
    const displayQuote = resolveDisplayCustomerQuote(storedQuote, fields)
    if (displayQuote) {
      return customerRequestSegmentsFromQuote(fields, displayQuote)
    }
  }

  /** @type {TicketDetailSegment[]} */
  const initial = []
  /** @type {TicketDetailSegment[]} */
  const appendSegs = []
  const seen = new Set()

  const acceptance = acceptanceCorpusForInitialRequests(fields)
  let initialSeq = 0

  for (const block of parseLabelValueBlocks(acceptance)) {
    if (!block.label) {
      if (isCustomerDemandContent(block.text)) {
        pushUnique(initial, seen, {
          label: '初次诉求',
          text: block.text,
          phase: 'initial',
          seq: initialSeq++,
        })
      }
      continue
    }
    if (isPlatformSolutionLabel(block.label) || isCustomerOutcomeLabel(block.label)) {
      continue
    }
    if (isCustomerRequestLabel(block.label) && !isPlatformActionContent(block.text)) {
      pushUnique(initial, seen, {
        label: block.label === '工单标题' ? '工单标题' : block.label,
        text: block.text,
        phase: 'initial',
        seq: initialSeq++,
      })
    }
  }

  if (!initial.length && acceptance?.trim()) {
    const inlineDetail = acceptance.match(INLINE_DETAIL_CONTENT_RE)
    if (inlineDetail?.[1]?.trim() && !isMeaninglessCustomerText(inlineDetail[1])) {
      pushUnique(initial, seen, {
        label: '详细内容',
        text: inlineDetail[1].trim(),
        phase: 'initial',
        seq: initialSeq++,
      })
    }
  }

  if (!initial.length && acceptance?.trim()) {
    const residual = stripKnownLabeledSections(acceptance)
    if (isCustomerDemandContent(residual)) {
      pushUnique(initial, seen, {
        label: '初次诉求',
        text: residual,
        phase: 'initial',
        seq: initialSeq++,
      })
    }
  }

  const append = extractAppendTextForDisplay(fields)
  if (append && !isMeaninglessCustomerText(append)) {
    const parts = append
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p && !isMeaninglessCustomerText(p) && isCustomerDemandContent(p))
    parts.forEach((part, index) => {
      pushUnique(appendSegs, seen, {
        label: parts.length > 1 ? `追加诉求 ${index + 1}` : '追加诉求',
        text: part,
        phase: 'append',
        seq: index,
      })
    })
  }

  const sorted = sortCustomerRequestSegments([...initial, ...appendSegs])
  const appendCount = sorted.filter((s) => s.phase === 'append').length
  let appendIdx = 0
  return sorted.map((seg) => {
    if (seg.phase !== 'append') return seg
    appendIdx += 1
    return {
      ...seg,
      label: appendCount > 1 ? `追加诉求 ${appendIdx}` : '追加诉求',
    }
  })
}

/**
 * @param {string} text
 */
function stripKnownLabeledSections(text) {
  let rest = text
  const labels = [
    ...CUSTOMER_REQUEST_LABELS,
    ...PLATFORM_SOLUTION_LABELS,
    ...CUSTOMER_OUTCOME_LABELS,
  ]
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    rest = rest.replace(
      new RegExp(`(?:^|\\n)${escaped}[（(][^）)]*[）)]?[：:][^\\n]*(?:\\n(?!\\S+[：:])[^\\n]*)*`, 'g'),
      '\n',
    )
    rest = rest.replace(new RegExp(`(?:^|\\n)${escaped}[：:][^\\n]*`, 'g'), '\n')
  }
  return rest.replace(/\n{2,}/g, '\n').trim()
}

/**
 * @param {TicketDetailSegment[]} segments
 * @param {Set<string>} seen
 * @param {TicketDetailSegment} item
 */
function pushSolution(segments, seen, item) {
  const text = item.text?.trim()
  if (!text || text.length < 2) return
  const key = `${item.label || 'solution'}\0${normalizeKey(text)}`
  if (seen.has(key)) return
  seen.add(key)
  segments.push({ label: item.label, text })
}

/**
 * 解决方案：平台针对客户请求给出的处理方案；客户侧结果单独提取，无则留空。
 *
 * @param {TicketDetailSourceFields} fields
 * @returns {{ solutions: TicketDetailSegment[]; customerOutcome: TicketDetailSegment[] }}
 */
export function extractSolutionAndResultParts(fields) {
  /** @type {TicketDetailSegment[]} */
  const solutions = []
  /** @type {TicketDetailSegment[]} */
  const customerOutcome = []
  const solutionSeen = new Set()
  const outcomeSeen = new Set()

  const handling = extractHandlingTextFromFields(fields)
  if (handling) {
    pushSolution(solutions, solutionSeen, { label: '处理意见', text: handling })
  }

  const cols = fields.sourceColumns || {}
  const responseText =
    fields.responseText?.trim() ||
    cols['解决方案（必填）']?.trim() ||
    cols['解决方案']?.trim() ||
    ''
  const solutionSummary = fields.solutionSummary?.trim() || ''
  if (responseText) {
    pushSolution(solutions, solutionSeen, { label: '解决方案', text: responseText })
  } else if (
    solutionSummary &&
    normalizeKey(solutionSummary) !== normalizeKey(handling || '')
  ) {
    pushSolution(solutions, solutionSeen, { label: '解决方案', text: solutionSummary })
  }

  const corpora = [
    extractAcceptanceTextFromFields(fields),
    fields.rawText?.trim() || '',
  ].filter(Boolean)

  for (const corpus of corpora) {
    for (const block of collectBlocksFromCorpus(corpus)) {
      if (!block.label) continue
      if (isPlatformSolutionLabel(block.label)) {
        pushSolution(solutions, solutionSeen, {
          label: normalizeLabel(block.label),
          text: block.text,
        })
      }
      if (isCustomerOutcomeLabel(block.label) && isCustomerOutcomeContent(block.text)) {
        pushUnique(customerOutcome, outcomeSeen, {
          label: '客户侧处理结果',
          text: block.text,
        })
      }
    }
  }

  for (const corpus of corpora) {
    if (!corpus) continue
    for (const match of corpus.matchAll(CUSTOMER_OUTCOME_CONTENT_HINT)) {
      const snippet = match[0]?.trim()
      if (snippet && isCustomerOutcomeContent(snippet)) {
        pushUnique(customerOutcome, outcomeSeen, {
          label: '客户侧处理结果',
          text: snippet,
        })
      }
    }
  }

  return { solutions, customerOutcome }
}

/** @deprecated 使用 extractSolutionAndResultParts */
export function extractSolutionAndResultSegments(fields) {
  const { solutions, customerOutcome } = extractSolutionAndResultParts(fields)
  return [...solutions, ...customerOutcome]
}

/**
 * @param {TicketDetailSegment[]} segments
 */
export function formatCustomerRequestSegments(segments) {
  if (!segments.length) return ''
  return segments
    .map((seg, index) => {
      const prefix = seg.label ? `${seg.label}：` : `${index + 1}. `
      return `${prefix}${seg.text}`
    })
    .join('\n\n')
}

/**
 * @param {{ solutions: TicketDetailSegment[]; customerOutcome: TicketDetailSegment[] }} parts
 */
export function formatSolutionAndResultParts(parts) {
  /** @type {string[]} */
  const lines = []

  if (parts.solutions.length) {
    const body = parts.solutions
      .map((seg) => (seg.label ? `【${seg.label}】\n${seg.text}` : seg.text))
      .join('\n\n')
    lines.push(body)
  }

  if (parts.customerOutcome.length) {
    const body = parts.customerOutcome
      .map((seg) => seg.text)
      .join('\n\n')
    lines.push(`【客户侧处理结果】\n${body}`)
  }

  return lines.join('\n\n')
}

/**
 * @param {TicketDetailSegment[]} segments
 */
export function formatSolutionAndResultSegments(segments) {
  return formatSolutionAndResultParts({
    solutions: segments.filter((s) => s.label !== '客户侧处理结果'),
    customerOutcome: segments.filter((s) => s.label === '客户侧处理结果'),
  })
}

/**
 * @param {import('./types.js').FeedbackRecord | Partial<import('./types.js').FeedbackRecord>} record
 */
export function buildTicketDetailDisplay(record) {
  const fields = {
    handlingText: record.handlingText,
    rawText: record.rawText,
    customerQuote: record.customerQuote,
    responseText: record.responseText,
    solutionSummary: record.solutionSummary,
    sourceColumns: record.sourceColumns,
  }
  const customerRequests = extractCustomerRequestSegments(fields)
  const solutionParts = extractSolutionAndResultParts(fields)
  return {
    customerRequests,
    customerRequestText: formatCustomerRequestSegments(customerRequests),
    solutionAndResult: [...solutionParts.solutions, ...solutionParts.customerOutcome],
    solutionAndResultText: formatSolutionAndResultParts(solutionParts),
    solutionParts,
  }
}
