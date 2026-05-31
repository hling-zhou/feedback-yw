import { canUseSemanticMatch } from './themeSemantic.js'
import { getEffectiveOptimization } from './ticketAnalysis/ticketOptimizationExtract.js'
import { collectEffectiveOptimizationsFromRecords } from './ticketAnalysis/effectiveOptimizationCollect.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from './llmClient.js'

/**
 * @deprecated Phase 1C 起旅程 Tab 不再调用 LLM 旅程举措；保留供 legacy / 其他模块引用。
 * 预计 1~2 个稳定周期后评估移除。
 */
const DEFAULT_MODEL = 'gpt-4o-mini'

/** 空泛话术，禁止作为业务优化举措输出 */
const GENERIC_PHRASES = [
  '待分析',
  '纳入版本规划',
  '制定根本解决方案',
  '复盘处理路径',
  '沉淀为标准作业程序',
  '建立同类问题预防机制',
  '推动产品研发修复并给出明确版本',
  '建议复盘本环节',
  '围绕根因',
  '待观察',
  '持续关注',
  '临时方案',
  '临时规避',
  '请客户观察',
  '已协助客户',
  '自助排查',
  '根因闭环',
  '标准化排查',
  '持续关注',
  '纳入规划',
  '加强运营',
  '提升用户体验',
  '持续优化',
  '专项改进',
  'backlog',
]

/** 行动建议专用：比举措判定更严的空泛模板 */
const GENERIC_RECOMMENDATION_RE = [
  /自助排查与根因闭环/,
  /标准化排查工具/,
  /体验闭环/,
  /根因治理/,
  /制定本周期体验改进/,
  /按产品与旅程环节分解增量/,
  /建立专项看板与周复盘/,
  /推动研发缺陷单闭环/,
  /建立该根因对应的控制台诊断/,
  /减少重复人工协查/,
  /需排查是否由特定产品/,
  /建立限时回访与升级机制/,
  /制定分阶段降万投目标/,
  /为该问题类型梳理\s*TOP\s*根因清单/,
  /在下一周期跟踪.*占比/,
  /跟踪\s*30\s*天.*复发率/,
  /优先补齐自助排查/,
  /结合旅程热点与问题类型，制定/,
  /投诉工单与订单量按月复盘/,
]

const BASE_SYSTEM_RULES = `要求：
1. 输出 3～5 条，每条必须具体、可执行，面向产品/平台/流程改进，用于举一反三规避同类问题。
2. 以「需求痛点 TOP」为主输入进行聚类归纳；可结合单条工单优化建议参考，但须系统化、去重后输出旅程级举措。
3. 若证据中含「人工复核优化建议」，须优先吸收其方向，且勿再使用对应工单的自动优化建议。
4. 禁止输出空泛套话，例如：「围绕根因制定方案」「纳入版本规划」「待分析」「复盘处理路径」「建立预防机制」等无实质内容的句子。
5. 不要复述工单回单里的临时规避操作（如「已协助客户调整」「请客户观察」），要提炼根本改进。
6. 结合证据中的真实痛点、有效根因、资源池差异，给出功能、流程、监控、文档、自助工具等方向的举措。
7. 每条 30～80 字，用中文，以动词开头（如「上线」「优化」「建立」「完善」）。
8. 只返回 JSON：{"measures":["举措1","举措2",...]}`

/**
 * 是否为工单回单/打标模板复述（禁止进入行动建议概述与详细意见）
 * @param {string} text
 */
export function isTicketDerivedPlanningText(text) {
  if (!text?.trim()) return true
  const t = text.trim()
  if (/针对根因「|针对高频根因「/.test(t)) return true
  if (/建立专项修复与验收标准/.test(t)) return true
  if (/目前进展|协助内容|处理意见|归档意见|受理内容|追加信息/.test(t)) return true
  if (/^原因：|^原因:/.test(t)) return true
  if (/telnet|tracert|ping\s+\d|\d+\.\*?\.\*?\.\*/i.test(t)) return true
  if (/\d{1,3}(?:\.\*|\.\d+|\.\*){2,3}\.\d+/.test(t)) return true
  if (/^\d+\s*[、.【]/.test(t)) return true
  if (/^【[^】]{0,20}$/.test(t)) return true
  if (/从\d+.*(云主机|主机|端口|访问)/.test(t)) return true
  if (/移动云投诉根因[：:]/.test(t)) return true
  if (t.length > 40 && /「[^」]{35,}」/.test(t)) return true
  return false
}

/**
 * @param {string} text
 */
export function isGenericMeasure(text) {
  if (!text?.trim()) return true
  const t = text.trim()
  if (t.length < 12) return true
  if (isTicketDerivedPlanningText(t)) return true
  return GENERIC_PHRASES.some((p) => t.includes(p))
}

/**
 * 行动建议概述/要点是否过于空泛（每期都可能相同）
 * @param {string} text
 */
export function isGenericRecommendationText(text) {
  if (isGenericMeasure(text)) return true
  const t = text.trim()
  return GENERIC_RECOMMENDATION_RE.some((r) => r.test(t))
}

/**
 * @param {string} text
 */
export function isValidRootCause(text) {
  if (!text?.trim()) return false
  const t = text.trim()
  if (t === '待分析' || t === '—') return false
  if (/^围绕根因/.test(t)) return false
  if (t.length < 6) return false
  return !isGenericMeasure(t)
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 */
function buildEvidencePack(items, limit = 12) {
  return items.slice(0, limit).map((fb, i) => ({
    index: i,
    painPoint: (fb.painPoint || fb.problemSummary || '').slice(0, 120),
    problem: (fb.painPoint || fb.problemSummary || fb.customerQuote || '').slice(0, 200),
    problemType: fb.problemType || '未分类',
    rootCause: isValidRootCause(fb.rootCause) ? fb.rootCause.slice(0, 150) : '',
    resourcePool: fb.resourcePool || '',
    optimizationHint: getEffectiveOptimization(fb).combined.slice(0, 160) || undefined,
  }))
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 * @param {number} [limit]
 */
function aggregatePainPoints(items, limit = 6) {
  const map = new Map()
  for (const fb of items) {
    const pain = (fb.painPoint || fb.problemSummary || '').trim()
    if (!pain || pain.length < 6) continue
    const key = pain.slice(0, 80)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }))
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 * @param {string} field
 */
function aggregateCount(items, field) {
  const map = new Map()
  for (const fb of items) {
    const v = fb[field]?.trim()
    if (!v) continue
    map.set(v, (map.get(v) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }))
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 * @param {string} l1
 * @param {string} l2
 * @param {{ productName?: string; l1Desc?: string; l2Desc?: string }} meta
 */
export function buildJourneyOptimizationContext(items, l1, l2, meta = {}) {
  const problemTypes = aggregateCount(items, 'problemType')
  const rootCauses = aggregateCount(items, 'rootCause').filter((r) => isValidRootCause(r.text))
  const pools = aggregateCount(items, 'resourcePool').slice(0, 5)
  const painPoints = aggregatePainPoints(items)
  const ticketOptimizations = collectEffectiveOptimizationsFromRecords(items, 8)
  return {
    productName: meta.productName || '云产品',
    journeyL1: l1,
    journeyL2: l2 || undefined,
    l1Description: meta.l1Desc || '',
    l2Description: meta.l2Desc || '',
    ticketCount: items.length,
    problemTypes,
    rootCauses,
    painPoints,
    ticketOptimizations,
    resourcePools: pools,
    samples: buildEvidencePack(items),
  }
}

/**
 * @param {Record<string, { text: string; source: string }[]>} childMeasuresByL2
 */
export function formatChildMeasuresForPrompt(childMeasuresByL2) {
  const entries = Object.entries(childMeasuresByL2 || {}).filter(([, ms]) => ms?.length)
  if (!entries.length) return ''
  return entries
    .map(([l2, ms]) => `- ${l2}：\n${ms.map((m, i) => `  ${i + 1}. ${m.text}`).join('\n')}`)
    .join('\n')
}

/**
 * @param {{ text: string; source: string }[]} measures
 */
export function formatMeasureListForPrompt(measures) {
  if (!measures?.length) return ''
  return measures.map((m, i) => `${i + 1}. ${m.text}`).join('\n')
}

function formatEvidenceBlock(ctx) {
  const painBlock =
    ctx.painPoints?.length
      ? ctx.painPoints.map((p) => `${p.text.slice(0, 60)}(${p.count})`).join('；')
      : '无明确痛点'
  const optBlock =
    ctx.ticketOptimizations?.length
      ? ctx.ticketOptimizations
          .map((o, i) => `${i + 1}. [${o.source}] ${o.text.slice(0, 100)}`)
          .join('\n')
      : '无单条优化建议'

  return `需求痛点 TOP（聚类主输入）：${painBlock}
问题类型分布：${ctx.problemTypes.map((p) => `${p.text}(${p.count})`).join('、') || '无'}
有效根因 TOP：${ctx.rootCauses.map((r) => `${r.text.slice(0, 60)}(${r.count})`).join('；') || '无明确根因'}
资源池：${ctx.resourcePools.map((p) => p.text).join('、') || '未标注'}

单条工单优化建议参考（可结合归纳，勿照搬；若含「人工复核优化建议」须优先采纳）：
${optBlock}

典型工单摘要（勿照搬为举措）：
${ctx.samples
  .map(
    (s) =>
      `[${s.index}] 痛点：${s.painPoint || s.problem}\n    类型：${s.problemType}${s.rootCause ? `\n    根因：${s.rootCause}` : ''}${s.optimizationHint ? `\n    单条建议：${s.optimizationHint}` : ''}`,
  )
  .join('\n')}`
}

/**
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {import('./storage.js').AppSettings} settings
 */
async function requestMeasuresFromLlm(systemPrompt, userPrompt, settings, maxCount = 6) {
  const data = await llmChatCompletion(settings, {
    model: settings.llmModel || DEFAULT_MODEL,
    temperature: 0.35,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })
  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const list = parsed.measures || parsed.items || parsed.recommendations || []

  return list
    .filter((m) => typeof m === 'string' && !isGenericMeasure(m))
    .slice(0, maxCount)
    .map((text) => ({ text: text.trim(), source: 'AI 分析' }))
}

/**
 * 二级旅程：输出具体可落地的分举措
 * @param {ReturnType<typeof buildJourneyOptimizationContext>} ctx
 * @param {import('./storage.js').AppSettings} settings
 * @param {{ parentL1Measures?: { text: string; source: string }[] }} [options]
 */
export async function synthesizeJourneyL2MeasuresWithLLM(ctx, settings, options = {}) {
  if (!canUseSemanticMatch(settings)) {
    throw new Error('服务端未配置 LLM（LLM_API_KEY），无法生成举措')
  }

  const parentBlock = options.parentL1Measures?.length
    ? `\n所属一级旅程已归纳的总领举措（勿重复，本二级举措应更具体、更可落地）：\n${formatMeasureListForPrompt(options.parentL1Measures)}\n`
    : ''

  const systemPrompt = `你是移动云产品运营与体验优化专家。根据某用户旅程「二级环节」下的投诉工单证据，输出可落地的「业务优化举措」（分）。

${BASE_SYSTEM_RULES}
7. 举措应针对本二级环节，比一级总领举措更细、更可落地；若已有一级总领方向，须与之对齐、形成总-分关系。
8. 每条举措须表述完整（含改进对象/功能点/流程节点），便于一级汇总时覆盖归纳，勿写过于笼统的单句。`

  const userPrompt = `产品：${ctx.productName}
用户旅程：${ctx.journeyL1} → ${ctx.journeyL2}
一级说明：${ctx.l1Description || '无'}
二级说明：${ctx.l2Description || '无'}
工单数：${ctx.ticketCount}
${parentBlock}
${formatEvidenceBlock(ctx)}

请输出该二级环节的具体业务优化举措（分）。`

  return requestMeasuresFromLlm(systemPrompt, userPrompt, settings, 6)
}

/**
 * 一级旅程：在二级举措基础上归纳总领举措
 * @param {ReturnType<typeof buildJourneyOptimizationContext>} ctx
 * @param {import('./storage.js').AppSettings} settings
 * @param {Record<string, { text: string; source: string }[]>} childMeasuresByL2
 */
export async function synthesizeJourneyL1MeasuresWithLLM(ctx, settings, childMeasuresByL2 = {}) {
  if (!canUseSemanticMatch(settings)) {
    throw new Error('服务端未配置 LLM（LLM_API_KEY），无法生成举措')
  }

  const childBlock = formatChildMeasuresForPrompt(childMeasuresByL2)
  const childSection = childBlock
    ? `\n各二级环节已归纳的具体举措（分）：\n${childBlock}\n`
    : '\n（暂无二级举措，请基于全部工单证据直接归纳一级总领方向。）\n'

  const systemPrompt = `你是移动云产品运营与体验优化专家。根据某用户旅程「一级环节」及其下属二级环节，输出总领性「业务优化举措」（总）。

${BASE_SYSTEM_RULES}
7. 一级举措是「总」，必须涵盖覆盖下属各二级的具体举措方向：各二级已提出的重要改进点，都应在某条一级举措中得到体现，不可遗漏；可合并同类项，但不得逐字复述二级原文。
8. 一级举措须保持与二级相近的具体性与可执行性（保留关键对象、功能点、流程节点、监控/指标等），不可为求「总」而写成空泛战略口号；可压缩表述，但不得丢失实质动作。
9. 除覆盖二级举措外，须审视各二级之间的共性、关联与缺口，视情况补充 0～2 条「跨二级综合」举措：由多条二级问题交叉启发、单一二级未能单独提出的改进；若无明显补充点则不必凑数。
10. 输出顺序：先写覆盖型总领举措（3～5 条），再写跨二级补充举措（如有）；两类合计 4～7 条。`

  const userPrompt = `产品：${ctx.productName}
用户旅程（一级）：${ctx.journeyL1}
一级说明：${ctx.l1Description || '无'}
工单数（含全部二级）：${ctx.ticketCount}
${childSection}
${formatEvidenceBlock(ctx)}

请输出该一级旅程的业务优化举措（总），要求：
A. 覆盖型总领举措：涵盖并统领上述各二级举措的具体方向，保持可执行的具体性；
B. 跨二级补充举措（0～2 条）：综合多个二级环节交叉启发、二级中尚未单独覆盖的改进点（无可补充则省略）。`

  return requestMeasuresFromLlm(systemPrompt, userPrompt, settings, 8)
}

/**
 * @param {ReturnType<typeof buildJourneyOptimizationContext>} ctx
 * @param {import('./storage.js').AppSettings} settings
 * @returns {Promise<{ text: string; source: string }[]>}
 */
export async function synthesizeJourneyMeasuresWithLLM(ctx, settings) {
  if (ctx.journeyL2) {
    return synthesizeJourneyL2MeasuresWithLLM(ctx, settings)
  }
  return synthesizeJourneyL1MeasuresWithLLM(ctx, settings)
}

/**
 * @param {string} cacheKey
 * @param {import('./types.js').FeedbackRecord[]} items
 * @param {string} l1
 * @param {string} l2
 * @param {{ productName?: string; l1Desc?: string; l2Desc?: string }} meta
 * @param {import('./storage.js').AppSettings} settings
 * @param {{
 *   childMeasuresByL2?: Record<string, { text: string; source: string }[]>
 *   parentL1Measures?: { text: string; source: string }[]
 * }} [options]
 */
export async function generateMeasuresForSegment(
  cacheKey,
  items,
  l1,
  l2,
  meta,
  settings,
  options = {},
) {
  if (items.length === 0) return []
  const ctx = buildJourneyOptimizationContext(items, l1, l2, meta)
  if (l2) {
    return synthesizeJourneyL2MeasuresWithLLM(ctx, settings, {
      parentL1Measures: options.parentL1Measures,
    })
  }
  return synthesizeJourneyL1MeasuresWithLLM(ctx, settings, options.childMeasuresByL2 || {})
}

export function segmentCacheKey(l1, l2, itemIds) {
  const ids = [...itemIds].sort().slice(0, 20).join(',')
  return `${l1}::${l2 || ''}::${ids.length}::${ids.slice(0, 80)}`
}
