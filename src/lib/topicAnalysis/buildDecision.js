function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`
}

function refIds(evidence) {
  return (evidence.evidenceIds || []).slice(0, 2)
}

function trendOf(pack) {
  const analysis = pack.analysis || {}
  const window = pack.window || {}
  if ((window.all || []).length < 3) return 'insufficient'
  if (analysis.scenarios?.includes('emerging')) return 'emerging'
  if (analysis.scenarios?.includes('worsening')) return 'worsening'
  if (analysis.baselineAvg >= 3 && analysis.recentAvg <= analysis.baselineAvg * 0.7) return 'declining'
  return 'steady'
}

function priorityOf(pack) {
  const trend = trendOf(pack)
  const highValue = Boolean(pack.analysis?.keyCustomer)
  const spreading = pack.analysis?.scenarios?.includes('cross_product')
  if (trend === 'worsening') return highValue || spreading ? 'P0' : 'P1'
  if (trend === 'emerging') return highValue ? 'P0' : 'P1'
  if (trend === 'insufficient') {
    return (pack.analysis?.highSeverity || 0) >= 2 && highValue ? 'P1' : 'P2'
  }
  return highValue ? 'P1' : 'P2'
}

function qualifier(pack, topic) {
  const sample = pack.sample || {}
  const problem = pack.dimensions?.problem || {}
  if (sample.total === 0) {
    return {
      text: '系统未匹配到记录',
      confidence: 'low',
      basis: '请补充材料或放宽关键词',
    }
  }
  if (sample.total < 5) {
    return {
      text: `${topic.title || '该专题'}存在相关反馈`,
      confidence: 'low',
      basis: `${sample.total} 条样本，暂作线索`,
    }
  }
  if (pack.splitSuggested || pack.semanticSplitSuggested) {
    return {
      text: '反馈指向多个不同问题',
      confidence: 'split',
      basis: pack.semanticSplitSuggested ? '原话可分为多个独立诉求，建议先拆分' : '建议先拆分专题再判断',
    }
  }
  const object = topic.type === 'customer'
    ? (topic.customerName || topic.customerCode || '该客户')
    : (topic.product || topic.title || '该专题')
  const context = pack.dimensions?.journeyL2?.top?.name || pack.dimensions?.requestScene?.top?.name
  const issue = problem.top?.name || '相关体验问题'
  return {
    text: `${object}${context ? `在${context}` : ''}遇到${issue}`.slice(0, 44),
    confidence: problem.headShare >= 0.5 ? 'high' : 'medium',
    basis: `${problem.top?.count || 0}/${problem.total || sample.total} 条集中于「${issue}」`,
  }
}

function attribution(pack) {
  const eligible = Object.entries(pack.dimensions || {})
    .filter(([key, value]) => key !== 'problem' && key !== 'product' && value.concentrated)
    .map(([key, value]) => ({ key, ...value, gap: value.headShare - value.secondShare }))
    .sort((a, b) => b.gap - a.gap)
  const chosen = eligible[0]
  if (!chosen || chosen.key === 'source') {
    return {
      text: '归因线索不足',
      confidence: 'low',
      dimension: '',
      basis: '记录未在同一维度集中',
      direction: '',
      role: '',
    }
  }
  const pathDimension = ['journeyL1', 'journeyL2', 'requestScene'].includes(chosen.key)
  const confidence = chosen.headShare >= 0.6 && chosen.total >= 8 ? 'high' : 'medium'
  return {
    text: `${pathDimension ? '用户路径/场景' : '产品侧配置或资源'}可能相关`,
    confidence,
    dimension: chosen.key,
    basis: `${chosen.top.name} 占 ${percent(chosen.headShare)}（${chosen.top.count}/${chosen.total}）`,
    direction: pathDimension ? '用户路径或使用场景' : '产品侧配置或资源',
    role: '产品',
  }
}

function urgency(pack, priority) {
  const trend = trendOf(pack)
  const labels = {
    worsening: '近期加重',
    emerging: '近期新出现',
    declining: '近期收敛',
    steady: '仍在持续',
    insufficient: '趋势样本不足',
  }
  const signals = [labels[trend]]
  if (pack.analysis?.keyCustomer) signals.push('高价值客户')
  if (pack.analysis?.scenarios?.includes('cross_product')) signals.push(`跨 ${pack.sample?.productCount || 0} 个产品`)
  if (pack.analysis?.scenarios?.includes('unresolved')) signals.push('存在未闭环信号')
  return {
    level: priority,
    label: priority === 'P0' ? '立即关注' : priority === 'P1' ? '排期处理' : '持续观察',
    signals: signals.filter(Boolean).slice(0, 4),
  }
}

function action(pack, priority, cause) {
  if (pack.sample?.total === 0) {
    return { what: '补充材料或放宽关键词', owner: '客服', when: '补充后重算', verify: '匹配到可用记录', type: 'collect' }
  }
  if (pack.splitSuggested || pack.semanticSplitSuggested) {
    return { what: '拆成多个专题', owner: '产品', when: '本周评估', verify: '每个专题标签集中', type: 'split' }
  }
  if (pack.inventory?.openCount) {
    return {
      what: `跟进：${pack.inventory.open[0]?.title || '已有举措'}`,
      owner: cause.role || '产品',
      when: priority === 'P0' ? '本周评估' : '纳入迭代',
      verify: '近期负向月均、回访未解决',
      type: 'follow_up',
    }
  }
  if (
    cause.confidence === 'low'
    && (pack.sample?.quoteCount || 0) >= 5
    && (pack.sample?.expectationRate || 0) >= 0.3
  ) {
    return {
      what: '核对说明与话术',
      owner: '运营或市场',
      when: priority === 'P0' ? '本周评估' : '纳入迭代',
      verify: '近期负向月均、匹配条数',
      type: 'expectation_gap',
    }
  }
  if (cause.confidence !== 'low' && priority !== 'P2') {
    return {
      what: pack.inventory?.doneCount || pack.inventory?.stoppedCount ? '换方向评审' : `评估${cause.direction}`,
      owner: cause.role || '产品',
      when: priority === 'P0' ? '本周评估' : '纳入迭代',
      verify: '近期负向月均、回访未解决',
      type: 'investigate',
    }
  }
  return {
    what: priority === 'P0' ? '补齐标签、原话和材料' : '持续观察',
    owner: '客服',
    when: priority === 'P0' ? '本周评估' : '观察',
    verify: '近期负向月均再升或回访未解决仍出现',
    type: 'observe',
  }
}

/**
 * Turns evidence signals into deterministic, evidence-backed decision data.
 * @param {{ topic: object, signalPack: object, evidenceIds?: string[] }} evidence
 */
export function buildTopicDecision(evidence) {
  const pack = evidence.signalPack || {}
  const topic = evidence.topic || {}
  const priority = priorityOf(pack)
  const qualitative = qualifier(pack, topic)
  const cause = attribution(pack)
  return {
    qualitative: { ...qualitative, sourceIds: refIds(evidence) },
    urgency: urgency(pack, priority),
    attribution: { ...cause, sourceIds: refIds(evidence) },
    action: action(pack, priority, cause),
    metrics: {
      total: pack.sample?.total || 0,
      negative: pack.sample?.negative || 0,
      negativeRate: pack.sample?.total ? pack.sample.negative / pack.sample.total : 0,
      productCount: pack.sample?.productCount || 0,
      monthCounts: pack.analysis?.monthCounts || {},
      recentAvg: pack.analysis?.recentAvg ?? null,
      baselineAvg: pack.analysis?.baselineAvg ?? null,
      openActionCount: pack.inventory?.openCount || 0,
    },
    distributions: {
      qualitative: (pack.dimensions?.problem?.rows || []).slice(0, 3),
      attribution: cause.dimension ? (pack.dimensions?.[cause.dimension]?.rows || []).slice(0, 3) : [],
    },
    signalPack: pack,
  }
}
