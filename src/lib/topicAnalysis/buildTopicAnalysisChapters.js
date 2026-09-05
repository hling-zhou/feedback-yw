import { DATA_SOURCE_LABELS } from '../../domain/enums.js'

const PATH_KEYS = new Set(['journeyL1', 'journeyL2', 'requestScene'])
const CONFIG_KEYS = new Set(['resourcePool', 'productSpec'])
const QUOTA_RE = /配额|权限/
const DIM_LABELS = {
  journeyL1: '用户旅程一级',
  journeyL2: '用户旅程二级',
  requestScene: '请求场景',
  resourcePool: '资源池',
  productSpec: '产品规格',
  problem: '问题类型',
  product: '产品',
}

function percent(share) {
  return `${Math.round((Number(share) || 0) * 100)}%`
}

function dimRows(pack, key, limit = 5) {
  return (pack.dimensions?.[key]?.rows || []).slice(0, limit)
}

function sourceIdsFrom(brief, extra = []) {
  const ids = []
  for (const id of extra) {
    if (id) ids.push(String(id))
  }
  for (const source of brief.sources || []) {
    if (source.ticketId) ids.push(String(source.ticketId))
    else if (source.id) ids.push(String(source.id))
  }
  return [...new Set(ids)].slice(0, 8)
}

function trendLabel(pack) {
  const scenarios = pack.analysis?.scenarios || []
  if (scenarios.includes('worsening')) return '近期加重'
  if (scenarios.includes('emerging')) return '近期新出现'
  const recent = pack.analysis?.recentAvg
  const baseline = pack.analysis?.baselineAvg
  if (Number.isFinite(recent) && Number.isFinite(baseline) && baseline >= 3 && recent <= baseline * 0.7) {
    return '近期收敛'
  }
  if ((pack.window?.all || []).length < 3) return '趋势样本不足'
  return '仍在持续'
}

function concentrationNote(pack) {
  const problem = pack.dimensions?.problem || {}
  if (pack.splitSuggested || pack.semanticSplitSuggested) {
    return '问题类型不够集中，建议先拆成多个专题再判断机制。'
  }
  if (problem.top?.name && problem.total) {
    return `最集中的问题类型是「${problem.top.name}」，占 ${percent(problem.headShare)}（${problem.top.count}/${problem.total}）。`
  }
  return '问题类型尚未形成明显头部。'
}

function buildQuantitative(brief, pack) {
  const metrics = brief.decision?.metrics || {}
  const countsBySource = Object.entries(brief.scope?.countsBySource || {}).map(([type, count]) => ({
    name: DATA_SOURCE_LABELS[type] || type,
    count,
  }))
  const inventory = pack.inventory || {}
  return {
    sourceMix: countsBySource,
    monthCounts: metrics.monthCounts || pack.analysis?.monthCounts || {},
    recentAvg: metrics.recentAvg ?? pack.analysis?.recentAvg ?? null,
    baselineAvg: metrics.baselineAvg ?? pack.analysis?.baselineAvg ?? null,
    trend: trendLabel(pack),
    structures: [
      { key: 'problem', title: '问题类型', rows: dimRows(pack, 'problem') },
      { key: 'product', title: '产品', rows: dimRows(pack, 'product') },
      { key: 'journeyL1', title: '用户旅程一级', rows: dimRows(pack, 'journeyL1') },
      { key: 'journeyL2', title: '用户旅程二级', rows: dimRows(pack, 'journeyL2') },
      { key: 'requestScene', title: '请求场景', rows: dimRows(pack, 'requestScene') },
      { key: 'resourcePool', title: '资源池', rows: dimRows(pack, 'resourcePool') },
      { key: 'productSpec', title: '产品规格', rows: dimRows(pack, 'productSpec') },
    ].filter((block) => block.rows.length),
    sentiment: {
      total: pack.sample?.total || metrics.total || 0,
      negative: pack.sample?.negative || metrics.negative || 0,
      negativeRate: pack.sample?.total
        ? pack.sample.negative / pack.sample.total
        : metrics.negativeRate || 0,
      expectationRate: pack.sample?.expectationRate || 0,
      expectationCount: pack.sample?.expectationCount || 0,
      highSeverity: pack.highSeverity || pack.analysis?.highSeverity || 0,
    },
    concentrationNote: concentrationNote(pack),
    splitSuggested: Boolean(pack.splitSuggested || pack.semanticSplitSuggested),
    inventory: {
      open: inventory.openCount || 0,
      done: inventory.doneCount || 0,
      stopped: inventory.stoppedCount || 0,
    },
  }
}

function groupedQuotes(brief, pack) {
  const quotes = brief.quotes || []
  const clusters = pack.quoteClusters || []
  if (!clusters.length) {
    return quotes.length ? [{ key: '用户原话', count: quotes.length, quotes }] : []
  }
  const used = new Set()
  const groups = clusters.map((cluster) => {
    const ids = new Set((cluster.recordIds || []).map(String))
    const rows = quotes.filter((quote) => ids.has(String(quote.recordId || quote.id)))
    rows.forEach((quote) => used.add(quote.id || quote.recordId))
    return { key: cluster.key, count: cluster.count, quotes: rows }
  })
  const rest = quotes.filter((quote) => !used.has(quote.id || quote.recordId))
  if (rest.length) groups.push({ key: '其他原话', count: rest.length, quotes: rest })
  return groups.filter((group) => group.quotes.length || group.count)
}

function buildQualitative(brief, pack) {
  const facts = []
  for (const row of brief.judgments || []) {
    if (row.text) facts.push({ id: row.id || row.text, text: row.text, sourceIds: row.sourceIds || [] })
  }
  const problem = pack.dimensions?.problem?.top
  const journey = pack.dimensions?.journeyL2?.top || pack.dimensions?.journeyL1?.top
  const scene = pack.dimensions?.requestScene?.top
  if (problem?.name && !facts.some((item) => item.text.includes(problem.name))) {
    facts.push({
      id: 'fact-problem',
      text: `反馈主要落在「${problem.name}」（${problem.count} 条）。`,
      sourceIds: sourceIdsFrom(brief),
    })
  }
  if (journey?.name) {
    facts.push({
      id: 'fact-journey',
      text: `用户旅程集中在「${journey.name}」（${journey.count} 条）。`,
      sourceIds: sourceIdsFrom(brief),
    })
  }
  if (scene?.name) {
    facts.push({
      id: 'fact-scene',
      text: `请求场景以「${scene.name}」为主（${scene.count} 条）。`,
      sourceIds: sourceIdsFrom(brief),
    })
  }
  return {
    facts: facts.slice(0, 6),
    quoteGroups: groupedQuotes(brief, pack),
    visits: brief.visits || [],
    supplements: brief.supplementItems || [],
    gaps: brief.toSupplement || [],
  }
}

function counterFor(dim, pack) {
  const others = Object.entries(pack.dimensions || {})
    .filter(([key, value]) => key !== dim.key && key !== 'source' && value?.concentrated)
    .map(([key, value]) => `${DIM_LABELS[key] || key}「${value.top?.name}」占 ${percent(value.headShare)}`)
  if (others.length) return `同时，${others.slice(0, 2).join('；')}，机制可能不止一条。`
  if (dim.headShare < 0.5) return '该维度头部不到一半，只能作为线索。'
  return ''
}

function buildHypotheses(brief, pack) {
  const sample = pack.sample || {}
  if (!sample.total) {
    return { blocked: 'empty', items: [], note: '系统未匹配到记录，无法提出发生机制假设。' }
  }
  if (sample.total < 5) {
    return { blocked: 'sparse', items: [], note: `${sample.total} 条样本不足，只作线索，不给主因。` }
  }
  if (pack.splitSuggested || pack.semanticSplitSuggested) {
    return { blocked: 'split', items: [], note: '反馈指向多个不同问题，应先拆专题，不给单一主因。' }
  }

  const items = []
  const pushDim = (key, statement) => {
    const dim = pack.dimensions?.[key]
    if (!dim?.concentrated || !dim.top?.name) return
    items.push({
      id: `hyp-${key}`,
      statement,
      dimension: key,
      dimensionLabel: DIM_LABELS[key] || key,
      share: dim.headShare,
      support: `${dim.top.name} 占 ${percent(dim.headShare)}（${dim.top.count}/${dim.total}）`,
      counter: counterFor({ key, headShare: dim.headShare }, pack),
      sourceIds: sourceIdsFrom(brief, dim.top.recordIds),
    })
  }

  const journey = pack.dimensions?.journeyL2?.top?.name || pack.dimensions?.journeyL1?.top?.name
  const scene = pack.dimensions?.requestScene?.top?.name
  if (pack.dimensions?.journeyL2?.concentrated || pack.dimensions?.journeyL1?.concentrated) {
    pushDim(
      pack.dimensions?.journeyL2?.concentrated ? 'journeyL2' : 'journeyL1',
      `更可能发生在用户路径「${journey}」上，而不是随机散落。`,
    )
  }
  if (pack.dimensions?.requestScene?.concentrated && scene) {
    pushDim('requestScene', `请求场景「${scene}」集中，问题可能由该使用情境触发。`)
  }
  if (pack.dimensions?.resourcePool?.concentrated) {
    pushDim(
      'resourcePool',
      `资源池「${pack.dimensions.resourcePool.top.name}」集中，产品侧资源配置或容量可能相关。`,
    )
  }
  if (pack.dimensions?.productSpec?.concentrated) {
    pushDim(
      'productSpec',
      `规格「${pack.dimensions.productSpec.top.name}」集中，可能是该类规格的能力或默认策略问题。`,
    )
  }

  const problem = pack.dimensions?.problem?.top
  if (problem?.name && QUOTA_RE.test(problem.name) && (pack.dimensions?.problem?.headShare || 0) >= 0.4) {
    items.push({
      id: 'hyp-quota',
      statement: `问题类型以「${problem.name}」为主，更像配额/权限门槛，而不是连通性故障。`,
      dimension: 'problem',
      dimensionLabel: '问题类型',
      share: pack.dimensions.problem.headShare,
      support: `${problem.count}/${pack.dimensions.problem.total} 条`,
      counter: '',
      sourceIds: sourceIdsFrom(brief),
    })
  }

  if ((pack.sample?.expectationRate || 0) >= 0.3 && (pack.sample?.quoteCount || 0) >= 5) {
    items.push({
      id: 'hyp-expect',
      statement: '原话里预期/承诺表述较多，可能是说明与实际能力不一致，而不只是功能故障。',
      dimension: 'expectation',
      dimensionLabel: '预期落差',
      share: pack.sample.expectationRate,
      support: `${pack.sample.expectationCount}/${pack.sample.quoteCount} 条原话含预期表述`,
      counter: '',
      sourceIds: sourceIdsFrom(brief),
    })
  }

  if ((brief.visits || []).length) {
    const visit = brief.visits[0]
    items.push({
      id: 'hyp-visit',
      statement: `客服拜访提到「${String(visit.text || '').slice(0, 40)}」，可与工单机制交叉验证。`,
      dimension: 'visit',
      dimensionLabel: '拜访结论',
      share: 0,
      support: `${brief.visits.length} 条匹配拜访`,
      counter: '拜访未按产品目录过滤，只能作旁证。',
      sourceIds: [],
    })
  }

  const ranked = items
    .sort((a, b) => (b.share || 0) - (a.share || 0))
    .slice(0, 3)
  return { blocked: '', items: ranked, note: ranked.length ? '以下为竞争假说，不是已证实根因。' : '各维度都不够集中，归因线索不足。' }
}

function buildChain(brief, pack, hypotheses) {
  const doing = pack.quoteClusters?.[0]?.key
    || pack.dimensions?.journeyL2?.top?.name
    || pack.dimensions?.requestScene?.top?.name
  const pain = (pack.painFragments || [])[0]?.name
  const problem = pack.dimensions?.problem?.top?.name
  const root = (pack.rootCauses || [])[0]
  const pool = pack.dimensions?.resourcePool?.top
  const spec = pack.dimensions?.productSpec?.top
  const inventory = pack.inventory || {}

  return [
    {
      id: 'doing',
      label: '用户在做什么',
      text: doing
        ? `用户主要在「${doing}」相关动作或路径上遇到问题。`
        : '工单未标出稳定的旅程/场景，用户动作环缺口。',
      missing: !doing,
    },
    {
      id: 'break',
      label: '在哪一步断',
      text: problem
        ? `断裂点落在「${problem}」${pain ? `，痛点高频片段是「${pain}」` : ''}。`
        : '问题类型不集中，断裂点环缺口。',
      missing: !problem,
    },
    {
      id: 'system',
      label: '系统或配置侧线索',
      text: root
        ? `工单沉淀根因以「${root.name}」较多（${root.count} 条）。`
        : pool?.name || spec?.name
          ? `工单未沉淀根因；${pool?.name ? `资源池偏「${pool.name}」` : ''}${pool?.name && spec?.name ? '，' : ''}${spec?.name ? `规格偏「${spec.name}」` : ''}。`
          : '工单未沉淀根因，资源池/规格也不集中。',
      missing: !root && !pool?.name && !spec?.name,
    },
    {
      id: 'expect',
      label: '预期落差',
      text: (pack.sample?.expectationRate || 0) >= 0.3
        ? `${percent(pack.sample.expectationRate)} 的原话含「我以为/承诺/宣传」等表述，预期落差可能是机制之一。`
        : '原话里预期落差表述不多，暂不作为主因。',
      missing: (pack.sample?.expectationRate || 0) < 0.3,
    },
    {
      id: 'now',
      label: '为何现在冒出来',
      text: [
        trendLabel(pack),
        pack.analysis?.keyCustomer ? '涉及高价值客户' : '',
        (pack.analysis?.scenarios || []).includes('cross_product') ? '跨多个产品出现' : '',
        inventory.openCount ? `已有 ${inventory.openCount} 项开放举措未闭环` : '',
      ].filter(Boolean).join('；') || '时间与库存信号不足。',
      missing: false,
    },
  ].map((step) => ({
    ...step,
    sourceIds: hypotheses.items[0]?.sourceIds || sourceIdsFrom(brief),
  }))
}

function buildRecommendations(brief, pack, hypotheses) {
  const action = brief.decision?.action || {}
  const items = []
  if (hypotheses.blocked === 'empty') {
    return [{
      id: 'rec-collect',
      type: 'collect',
      title: '先补齐证据',
      why: '当前周期没有匹配记录。',
      text: action.what || '补充材料或放宽关键词后再重算。',
      sourceIds: [],
    }]
  }
  if (hypotheses.blocked === 'split' || pack.splitSuggested || pack.semanticSplitSuggested) {
    items.push({
      id: 'rec-split',
      type: 'split',
      title: '先拆专题',
      why: hypotheses.note,
      text: '按问题类型或产品拆成多个专题后再判断机制，不要直接立项修产品。',
      sourceIds: sourceIdsFrom(brief),
    })
    if ((pack.inventory?.openCount || 0) > 0) {
      items.push({
        id: 'rec-follow',
        type: 'follow_up',
        title: '先跟进已有举措',
        why: `库存中有 ${pack.inventory.openCount} 项开放举措。`,
        text: `跟进「${pack.inventory.open?.[0]?.title || '已有举措'}」，避免重复立项。`,
        sourceIds: [],
      })
    }
    return items
  }
  if ((pack.inventory?.openCount || 0) > 0) {
    items.push({
      id: 'rec-follow',
      type: 'follow_up',
      title: '先跟进已有举措',
      why: `库存中有 ${pack.inventory.openCount} 项开放举措。`,
      text: `跟进「${pack.inventory.open?.[0]?.title || '已有举措'}」，避免重复立项。`,
      sourceIds: [],
    })
  }
  for (const hyp of hypotheses.items) {
    if (items.length >= 4) break
    if (hyp.id === 'hyp-expect') {
      items.push({
        id: 'rec-expect',
        type: 'expectation_gap',
        title: '核对说明与话术',
        why: hyp.support,
        text: '对照宣传/控制台说明与实际能力，先改预期再评估是否改产品。',
        sourceIds: hyp.sourceIds,
        hypothesisId: hyp.id,
      })
      continue
    }
    if (CONFIG_KEYS.has(hyp.dimension)) {
      items.push({
        id: `rec-${hyp.dimension}`,
        type: 'investigate',
        title: `评估${hyp.dimensionLabel}`,
        why: hyp.support,
        text: `核对「${pack.dimensions?.[hyp.dimension]?.top?.name || ''}」上的容量、默认策略或已知限制。`,
        sourceIds: hyp.sourceIds,
        hypothesisId: hyp.id,
      })
      continue
    }
    if (PATH_KEYS.has(hyp.dimension) || hyp.id === 'hyp-quota') {
      items.push({
        id: `rec-${hyp.id}`,
        type: 'investigate',
        title: '沿该路径复核产品能力',
        why: hyp.support,
        text: hyp.statement,
        sourceIds: hyp.sourceIds,
        hypothesisId: hyp.id,
      })
    }
  }
  if (!items.length) {
    items.push({
      id: 'rec-observe',
      type: action.type || 'observe',
      title: action.type === 'observe' ? '持续观察' : (action.what || '补齐标签与原话'),
      why: hypotheses.note || '归因线索不足。',
      text: action.what || '持续观察近期负向月均与回访未解决。',
      sourceIds: sourceIdsFrom(brief),
    })
  }
  return items.slice(0, 4)
}

/**
 * @param {object} brief
 */
export function buildTopicAnalysisChapters(brief = {}) {
  const pack = brief.signalPack || brief.decision?.signalPack || {}
  const hypotheses = buildHypotheses(brief, pack)
  const whyHappened = {
    disclaimer: '本章是机制假设，不是已证实根因。',
    chain: buildChain(brief, pack, hypotheses),
    hypotheses,
    crossTabs: [
      { key: 'problemByJourney', title: '问题类型 × 旅程二级', rows: pack.crossTabs?.problemByJourney || [] },
      { key: 'problemByPool', title: '问题类型 × 资源池', rows: pack.crossTabs?.problemByPool || [] },
      { key: 'problemBySpec', title: '问题类型 × 规格', rows: pack.crossTabs?.problemBySpec || [] },
    ].filter((table) => table.rows.length),
    narrative: '',
    sourceIds: hypotheses.items[0]?.sourceIds || sourceIdsFrom(brief),
  }
  return {
    quantitative: buildQuantitative(brief, pack),
    qualitative: buildQualitative(brief, pack),
    whyHappened,
    recommendations: buildRecommendations(brief, pack, hypotheses),
    narrative: '',
  }
}

/**
 * 旧报告没有 analysis 时现场拼一版。
 * @param {object | null | undefined} brief
 */
export function ensureTopicAnalysis(brief) {
  if (!brief) return brief
  if (brief.analysis?.quantitative && brief.analysis?.whyHappened) return brief
  return { ...brief, analysis: buildTopicAnalysisChapters(brief) }
}
