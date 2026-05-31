import { DATA_SOURCE_LABELS } from '../domain/enums.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendationScope} OverviewRecommendationScope */
/** @typedef {import('../domain/overviewConclusions.js').RecommendationCategory} RecommendationCategory */

/** @typedef {'journey_hotspot' | 'problem_type' | 'wan_tou' | 'root_cause' | 'risk_negative' | 'risk_trend'} PlanningSignalType */

/** 行动建议条数上限（实际展示条数按周期内产品体量动态计算，不超过此值） */
export const MAX_PLANNING_RECOMMENDATIONS = 48

/** 大单量产品（工单数≥此值）建议条数区间 */
export const LARGE_PRODUCT_TICKET_THRESHOLD = 300
export const LARGE_PRODUCT_REC_MIN = 3
export const LARGE_PRODUCT_REC_MAX = 8

/** 行动建议内容模板：篇幅与条数约束 */
export const PLANNING_RECOMMENDATION_LIMITS = {
  maxItems: MAX_PLANNING_RECOMMENDATIONS,
  minDetails: 2,
  maxDetails: 4,
  maxSummaryLength: 88,
  maxDetailLength: 96,
  minSummaryLength: 12,
  maxEvidenceTickets: 5,
}

/** 概述/详细意见须含以下动作词之一 */
export const PLANNING_ACTION_VERBS = [
  '建立',
  '完善',
  '优化',
  '上线',
  '补齐',
  '跟踪',
  '推动',
  '梳理',
  '制定',
  '治理',
  '优先',
  '诊断',
  'playbook',
  '看板',
  '监控',
  '自助',
  '排查',
  '闭环',
  '立项',
  '改造',
  '固化',
  '沉淀',
  '纳入',
  '降低',
  '提升',
  '减少',
  '缩短',
  '增强',
  '预检',
  '向导',
  '工具',
  '能力',
  '流程',
  '验收',
  '预警',
  '回归',
  '专项',
  '打通',
  '建设',
  '提供',
  '支持',
  '实现',
  '展示',
  '修复',
  '绑定',
  '发布',
]

export const PLANNING_ACTION_RE =
  /建立|完善|优化|上线|补齐|跟踪|推动|梳理|制定|治理|优先|诊断|playbook|看板|监控|自助|排查|闭环|立项|改造|固化|沉淀|纳入|降低|提升|减少|缩短|增强|预检|向导|工具|能力|流程|验收|预警|回归|专项|打通|建设|提供|支持|实现|展示|修复|绑定|发布/

/** 导出/PDF 字段标签 */
export const PLANNING_EXPORT_LABELS = {
  details: '详细意见：',
  evidenceNote: '依据说明：',
  evidenceTickets: '依据工单：',
  trackingMetrics: '跟踪指标：',
}

/**
 * @type {Record<PlanningSignalType, { trackingMetrics: string[]; defaultCategory: RecommendationCategory; summaryHint: string }>}
 */
export const SIGNAL_TYPE_TEMPLATE = {
  journey_hotspot: {
    trackingMetrics: ['环节投诉占比', '单均协查时长', '30天复发率'],
    defaultCategory: 'product',
    summaryHint: '该旅程环节 Top 改进方向（ playbook / 自助排查 / 体验闭环）',
  },
  problem_type: {
    trackingMetrics: ['类型占比', '单均闭环时长'],
    defaultCategory: 'product',
    summaryHint: '该问题类型的标准化工具、控制台能力或 backlog 专项',
  },
  wan_tou: {
    trackingMetrics: ['万投比', 'Top问题类型占比'],
    defaultCategory: 'monitoring',
    summaryHint: '产品质量专项治理，以万投比与投诉复发率为验收',
  },
  root_cause: {
    trackingMetrics: ['根因复发率', '相关环节投诉数'],
    defaultCategory: 'product',
    summaryHint: '平台缺陷/配置链路修复 + 控制台自助诊断',
  },
  risk_negative: {
    trackingMetrics: ['负面占比', '回访闭环率'],
    defaultCategory: 'process',
    summaryHint: '根因闭环机制 + 可产品化体验短板修复',
  },
  risk_trend: {
    trackingMetrics: ['工单总量', 'Top环节占比'],
    defaultCategory: 'monitoring',
    summaryHint: '体验专项 + 环节占比监控看板',
  },
}

/**
 * @param {PlanningSignalType} signalType
 */
export function trackingMetricsForSignal(signalType) {
  return SIGNAL_TYPE_TEMPLATE[signalType]?.trackingMetrics || ['环节占比', '闭环时长']
}

/**
 * @param {OverviewRecommendationScope} scope
 */
/**
 * 行动建议类别排序：产品/功能 > 体验(文档自助) > 流程/监控
 * @param {RecommendationCategory | undefined} category
 */
export function planningCategoryRank(category) {
  switch (category) {
    case 'product':
      return 0
    case 'docs':
      return 1
    case 'monitoring':
      return 2
    case 'process':
      return 3
    default:
      return 1
  }
}

export function buildScopeLabel(scope) {
  if (!scope) return ''
  if (scope.product && scope.journeyL2 && scope.problemType && scope.requestScene) {
    return `「${scope.product}·${scope.journeyL2}·${scope.problemType}·${scope.requestScene}」`
  }
  if (scope.product && scope.journeyL2 && scope.problemType) {
    return `「${scope.product}·${scope.journeyL2}·${scope.problemType}」`
  }
  if (scope.product && scope.requestScene && scope.problemType) {
    return `「${scope.product}·${scope.requestScene}·${scope.problemType}」`
  }
  if (scope.product && scope.journeyL2) {
    return `「${scope.product}·${scope.journeyL2}」`
  }
  if (scope.product && scope.problemType) {
    return `「${scope.product}·${scope.problemType}」`
  }
  if (scope.journeyL2) {
    return scope.journeyL1
      ? `「${scope.journeyL1} → ${scope.journeyL2}」`
      : `「${scope.journeyL2}」`
  }
  if (scope.problemType) return `「${scope.problemType}」`
  if (scope.product) return `「${scope.product}」`
  return ''
}

/**
 * @param {OverviewRecommendationScope} [scope]
 */
export function buildScopeLabelFromParts(scope) {
  return buildScopeLabel(scope || {})
}

/**
 * 概述模板：建议{范围}：{动作}…
 * @param {string} scopeLabel
 * @param {string} primaryAction
 * @param {number} [maxLength]
 */
export function formatScopedSummary(scopeLabel, primaryAction, maxLength = PLANNING_RECOMMENDATION_LIMITS.maxSummaryLength) {
  const action = (primaryAction || '').trim()
  if (!action) return ''
  if (!scopeLabel || action.startsWith('建议')) {
    return action.length > maxLength ? `${action.slice(0, maxLength - 1)}…` : action
  }
  const snippet = action.slice(0, maxLength - scopeLabel.length - 4)
  const suffix = action.length > snippet.length ? '…' : ''
  return `建议${scopeLabel}：${snippet}${suffix}`
}

/**
 * @param {Object} ctx
 * @param {string} [ctx.product]
 * @param {string} [ctx.journeyL1]
 * @param {string} [ctx.journeyL2]
 * @param {string} [ctx.problemType]
 */
export function buildScopeLabelFromContext(ctx) {
  /** @type {OverviewRecommendationScope} */
  const scope = {
    product: ctx.product,
    journeyL1: ctx.journeyL1,
    journeyL2: ctx.journeyL2,
    problemType: ctx.problemType,
    requestScene: ctx.requestScene,
  }
  return buildScopeLabel(scope)
}

/**
 * @param {string} productName
 */
export function resolveProductPlanningProfile(productName) {
  const n = (productName || '').trim()
  if (/云专线|专线/.test(n)) return 'dc'
  if (/负载均衡|SLB|ELB/i.test(n)) return 'slb'
  if (/弹性公网|EIP|公网\s*IP/i.test(n)) return 'eip'
  return 'generic'
}

/** @type {Record<string, { default: string; journey?: Record<string, string> }>} */
export const PRODUCT_PLANNING_PROFILES = {
  dc: {
    default:
      '围绕专线开通交付与跨省落地，建设订单全流程可视化、VPC/路由配置冲突预检与链路质量主动预警，缩短开通与协查周期。',
    journey: {
      '订购开通与加急':
        '打通订单→审批→施工→交付状态机：控制台展示阻塞节点、责任方与预计完成时间，加急场景标准化 SLA 与落地协同接口。',
      '订单状态异常':
        '修复订单与资源/计费状态不同步，MOP/EMOP 异常提供自助诊断码与一线处理 checklist，失败订单自动补偿任务。',
      '路由与 VPC 配置':
        '上线 VPC/子网/路由配置向导与冲突检测，跨 VPC 互通与专线接入提供标准拓扑模板与验收 checklist。',
      '链路质量与丢包':
        '建立专线链路质量探测与主动预警，跨省/跨运营商场景提供绕行建议与升级处理机制。',
      '跨省与落地协调':
        '跨省落地协调流程线上化，机房端口/链路开通进度对客户可视化，明确各地客响接口与 SLA。',
    },
  },
  slb: {
    default:
      '围绕监听/后端/健康检查/转发规则配置链路，建设分步配置向导、依赖预检与变更生效说明，降低配置类重复工单。',
    journey: {
      '监听与端口配置':
        '控制台「创建监听」分步向导：协议/端口/证书校验，失败时给出错误码与依赖项（后端组、证书、配额）及修复路径。',
      '后端与服务器组':
        '优化后端组添加流程：展示 ECS/ENI 状态、权重与健康检查联动，失败时输出不可添加原因与自助修复项。',
      '健康检查配置':
        '健康检查模板化（间隔/阈值/协议），探测失败时区分后端异常与监听配置问题，并给出控制台诊断入口。',
      '转发策略与规则':
        '转发规则优先级可视化与冲突检测，变更支持预览与生效时间说明，避免「已改未生效」类误解工单。',
      '配额与权限申请':
        '实例数/服务器组/访问控制组配额前置展示与一键申请，创建前拦截不可达配置并提示缺失 IAM 权限项。',
      '访问不通与错误码':
        '502/503/504 等错误码映射到监听/后端/健康检查/证书四类根因，提供端到端探测与修复建议。',
      '订单与审核异常':
        '退订/开通订单状态与资源侧对齐，审核中订单展示节点与预计完成时间，异常订单自助诊断。',
    },
  },
  eip: {
    default:
      '围绕 EIP 开通、绑定与公网连通，建设配额/权限预检、网络就绪检测与连通性诊断工具，降低重复协查。',
    journey: {
      '权限及配额限制':
        '建设配额/权限预检与申请引导，在创建、绑定与升降配前拦截不可达操作并输出缺失权限与配额项。',
      '创建/申购 EIP':
        '开通/申购失败时输出可操作错误码、依赖项与配额说明，支持自助重试与配额申请跳转，减少开通类重复咨询。',
      '产品上架与交付':
        '订单→审批→开通全流程可视化，交付节点、阻塞原因与预计完成时间对客户可见，缩短上架等待类咨询。',
      '公网访问不通':
        '建设 EIP 连通性诊断（绑定关系/路由/安全组/线路），区分平台侧与客户侧结论并给出修复路径。',
      '带宽升降配':
        '升降配前展示计费影响与生效时间，失败时区分配额/实例状态/计费限制并给出自助处理指引。',
      '计费模式咨询':
        '统一按量/包年计费说明与试算器，控制台用量与账单项对齐，减少商务类重复咨询。',
    },
  },
}

/**
 * @param {string} productName
 * @param {{ journeyL2?: string; problemType?: string; requestScene?: string }} [ctx]
 */
export function buildProductPrimaryAction(productName, ctx = {}) {
  const profileKey = resolveProductPlanningProfile(productName)
  const profile = PRODUCT_PLANNING_PROFILES[profileKey]
  if (!profile) return null
  const j2 = ctx.journeyL2?.trim()
  if (j2 && profile.journey?.[j2]) return profile.journey[j2]
  const alias =
    j2 &&
    Object.entries(profile.journey || {}).find(([k]) => j2.includes(k) || k.includes(j2))
  if (alias) return alias[1]
  if (j2) {
    const typed = buildProblemTypePrimaryAction(ctx.problemType || '')
    if (typed) return typed
    return null
  }
  return profile.default || null
}

/**
 * 无 playbook 命中时的概述兜底（不含工单/根因原文）
 * @param {Object} ctx
 * @param {string} [ctx.journeyL1]
 * @param {string} [ctx.journeyL2]
 * @param {string} [ctx.problemType]
 * @param {string} [ctx.product]
 */
export function buildFallbackPrimaryAction(ctx) {
  if (ctx.product) {
    const productAction = buildProductPrimaryAction(ctx.product, ctx)
    if (productAction) return productAction
  }
  if (ctx.journeyL2 && !/未知|未识别/.test(ctx.journeyL2)) {
    return `优先改进「${ctx.journeyL1} → ${ctx.journeyL2}」环节的产品体验与自助排查能力，降低重复协查与投诉复发。`
  }
  if (ctx.problemType) {
    const typed = buildProblemTypePrimaryAction(ctx.problemType)
    if (typed) return typed
    return `针对「${ctx.problemType}」类问题建设标准化排查工具与控制台能力，纳入产品 backlog 专项跟踪。`
  }
  if (ctx.product) {
    return `围绕「${ctx.product}」Top 体验短板立项专项改进，以环节投诉率与闭环时长为验收指标。`
  }
  return `针对该环节高频平台/配置类根因，立项修复并在控制台增加自助诊断与预检能力。`
}

/** 问题类型 → 概述动作（咨询单分议题规划，12 类） */
export const PROBLEM_TYPE_PRIMARY_ACTIONS = {
  '资源开通与创建':
    '建立资源创建前预检与失败自愈指引，对资源不足/开通超时场景给出可执行 remediation 路径。',
  '配额与权限申请':
    '建立配额预警、权限自检与申请引导一体化能力，在创建前拦截不可达订单并降低配额类重复咨询。',
  '产品功能需求':
    '建立需求 intake 与排期可视化机制，在控制台/工单侧同步 roadmap 与交付窗口，减少无反馈重复咨询。',
  '配置与操作':
    '补齐控制台/API 对接配置向导与常见错误码说明，降低配置类重复咨询与协查成本。',
  '计费与账单':
    '统一账单项与控制台用量展示，对复杂计费/折扣场景提供试算与典型样例，减少商务类重复咨询。',
  '可用性/连通性故障':
    '完善连通性诊断工具与 TOP 场景 playbook，区分客户侧/平台侧/线路侧结论，缩短排查闭环。',
  '性能问题':
    '建立性能基线与链路质量探测能力，对慢/卡顿/丢包场景提供标准排查路径与主动预警。',
  '界面与操作易用性':
    '优化控制台关键路径交互与提示文案，对高频误操作场景增加引导与前置校验。',
  '退订与释放':
    '梳理退订/释放依赖链路与阻塞原因展示，提供自助释放检查与失败 remediation 指引。',
  '产品功能咨询':
    '结构化产品能力/规则 FAQ 与工单进度查询入口，减少重复咨询与信息不一致。',
  '人工服务与流程':
    '优化工单流转 SLA 可视化与升级/回访机制，降低因响应时效与服务流程引发的重复投诉。',
}

/**
 * @param {string} [problemType]
 * @returns {string | null}
 */
export function buildProblemTypePrimaryAction(problemType) {
  if (!problemType?.trim()) return null
  return PROBLEM_TYPE_PRIMARY_ACTIONS[problemType.trim()] || null
}

/**
 * @param {PlanningSignalType} signalType
 * @param {Object} ctx
 */
export function buildPrimaryActionForSignal(signalType, ctx = {}) {
  switch (signalType) {
    case 'wan_tou':
      return ctx.problemType
        ? `围绕「${ctx.problemType}」主诉类型推进产品根因治理与体验专项，以万投比与投诉复发率为验收指标。`
        : `围绕「${ctx.product}」推进万投比治理与体验专项，以投诉复发率为验收指标。`
    case 'risk_negative':
      return `强化${DATA_SOURCE_LABELS[ctx.dataSourceType] || '投诉'}负面情绪工单的根因闭环与回访机制，优先修复可产品化的体验短板。`
    case 'risk_trend':
      return '针对工单量上升聚焦 Top 产品与问题类型，立项体验专项并建立环节占比监控看板。'
    default:
      return buildFallbackPrimaryAction(ctx)
  }
}

/**
 * 详细意见兜底模板（2～4 条中的补充行）
 * @param {'journey' | 'rootCause' | 'problemType'} kind
 * @param {Object} ctx
 * @param {string} [ctx.journeyL2]
 * @param {string} [ctx.problemType]
 */
export function buildDetailFallbackLine(kind, ctx) {
  switch (kind) {
    case 'journey':
      return ctx.journeyL2
        ? `在「${ctx.journeyL2}」环节上线连通性/配置自助排查向导，输出平台侧与客户侧结论，缩短协查闭环。`
        : null
    case 'rootCause':
      return '针对该环节高频根因类型，明确平台改造项、回归用例与控制台提示文案，纳入版本验收。'
    case 'problemType':
      return ctx.problemType
        ? `为「${ctx.problemType}」类问题建设标准化排查 playbook 与一线工具，减少重复人工协查。`
        : null
    default:
      return null
  }
}

/**
 * @param {Object} params
 * @param {PlanningSignalType} params.signalType
 * @param {string} [params.journeyL1]
 * @param {string} [params.journeyL2]
 * @param {string} [params.problemType]
 * @param {string} [params.product]
 * @param {number} [params.count]
 * @param {number} [params.sharePct]
 * @param {{ text: string; count: number }} [params.topRootCause]
 * @param {string} [params.wanTouRatio]
 * @param {number} [params.complaintCount]
 * @param {import('../domain/enums.js').DataSourceType} [params.dataSourceType]
 * @param {number} [params.negativePct]
 * @param {number} [params.trendDeltaPct]
 */
export function buildEvidenceNoteForSignal(params) {
  const { signalType } = params
  switch (signalType) {
    case 'journey_hotspot': {
      const seg = params.journeyL1 && params.journeyL2
        ? `「${params.journeyL1} → ${params.journeyL2}」`
        : params.journeyL2
          ? `「${params.journeyL2}」`
          : '该环节'
      const rc = params.topRootCause
      return `本期${seg}${params.count ?? 0} 单${
        rc ? `，Top 根因「${rc.text.slice(0, 30)}」${rc.count} 单` : ''
      }`
    }
    case 'problem_type':
      return `本期「${params.problemType}」${params.count ?? 0} 单（占 ${params.sharePct ?? 0}%）`
    case 'wan_tou':
      return `「${params.product}」万投比 ${params.wanTouRatio}，投诉 ${params.complaintCount ?? 0} 单`
    case 'root_cause':
      return `根因「${(params.topRootCause?.text || '').slice(0, 40)}」${params.count ?? 0} 单`
    case 'risk_negative':
      return `${DATA_SOURCE_LABELS[params.dataSourceType] || '投诉'}负面占比 ${params.negativePct ?? 0}%`
    case 'risk_trend':
      return `跨源月度趋势环比 +${params.trendDeltaPct ?? 0}%`
    default:
      return ''
  }
}

/**
 * 工作台「行动建议」问号说明：与规则引擎常量对齐的完整生成规则
 * @returns {{ title: string; paragraphs?: string[]; items?: string[] }[]}
 */
export function buildPlanningRecommendationsHelpSections() {
  const { minDetails, maxDetails, maxSummaryLength, maxDetailLength, maxItems } =
    PLANNING_RECOMMENDATION_LIMITS
  return [
    {
      title: '生成时机与数据范围',
      paragraphs: [
        '在洞察工作台点击「生成 / 刷新洞察」后，系统基于当前洞察周期内的投诉单与咨询单工单生成，并写入周期快照。',
        '导入数据、修改标签或批量重新打标后，需再次刷新洞察，行动建议才会与最新工单分布一致。',
        '批量重新打标不会覆盖已在工单详情中人工保存过的四维标签（请求场景、问题类型、用户旅程、用户情绪）。',
      ],
    },
    {
      title: '条数规则（按产品工单量）',
      items: [
        `周期内每个产品（该品工单数 ≥ 3）至少 1 条；全模块合计不超过 ${maxItems} 条。`,
        '工单数 < 30：1 条',
        '30～99 条：2 条',
        '100～299 条：3 条',
        `≥ ${LARGE_PRODUCT_TICKET_THRESHOLD} 条：按体量在 ${LARGE_PRODUCT_REC_MIN}～${LARGE_PRODUCT_REC_MAX} 条之间缩放（结合多议题分散，避免只保留单一热点）`,
      ],
    },
    {
      title: '议题维度（大单量产品）',
      items: [
        '按产品分别生成候选，再按配额选取；优先覆盖不同分析轴，避免同产品多条建议仅重复同一话术。',
        `二级用户旅程（journeyL2）：大单量最多取 Top ${8} 个环节`,
        `问题类型（problemType）：最多 Top ${6} 类；若某类型已由主导旅程覆盖，则不再单独重复`,
        `请求场景（requestScene）：最多 Top ${4} 类，用于补充旅程/类型未覆盖的咨询场景`,
        '同一产品下，不同旅程、问题类型或请求场景不会仅因摘要措辞相近而被合并为一条',
      ],
    },
    {
      title: '优先级与类别排序',
      items: [
        '建议类型优先顺序：产品/功能设计 > 体验与文档自助 > 监控预警 > 流程与协同（与产品规划讨论习惯对齐）',
        '展示与选取时，同类中再按高 / 中 / 低优先级排序',
        '内容须为可落地举措（含建立、优化、上线、诊断、预检、打通等动作词），避免空泛统计描述',
      ],
    },
    {
      title: '概述与详细意见格式',
      items: [
        `概述 summary：1～2 句，≤${maxSummaryLength} 字；推荐句式「建议{产品·环节/问题类型}：{动作}，{预期价值}」`,
        `详细意见 details：${minDetails}～${maxDetails} 条，每条 ≤${maxDetailLength} 字；与洞察中「业务优化举措」同标准（环节 playbook、类型归纳、人工复核举措等）`,
        '依据说明 evidenceNote、指标 metrics、依据工单号由系统保留，概述中不写占比、万投比、工单原文或处理意见复述',
        '若开启「规则 + LLM」润色，仅润色概述与详细意见表述，不改范围、优先级与依据字段',
      ],
    },
    {
      title: '产品专项话术',
      items: [
        '云专线、弹性负载均衡（SLB）、弹性公网 IP（EIP）等配置了产品画像：按二级旅程优先匹配专用改进方向（如专线开通/路由、监听/后端/健康检查、EIP 配额/连通等）',
        '无画像产品时，按问题类型 playbook 或旅程/类型组合生成',
      ],
    },
    {
      title: '补充信号（样本允许时）',
      items: [
        '万投比异常产品、有效根因聚类、跨源负面情绪占比偏高、工单量环比明显上升等，可在配额未满时追加少量建议',
        '某产品无法形成足够具体的候选时，会尝试按该产品 Top 旅程或问题类型补 1 条；仍不足则本期可能无行动建议，并提示补充打标/人工复核',
      ],
    },
  ]
}

/**
 * LLM 润色时注入的行动建议模板规则（与规则生成对齐）
 */
export function buildPlanningRecommendationLlmRules() {
  return `【行动建议内容模板】（Phase 3：仅润色可编辑字段，结构化区块由系统保留）
- 条数：全模块最多 ${PLANNING_RECOMMENDATION_LIMITS.maxItems} 条。
- 概述 summary：严格 1 句、≤${PLANNING_RECOMMENDATION_LIMITS.maxSummaryLength} 字；优先句式「建议{产品·环节/旅程/问题类型}：{动作}，{预期价值}」；须含动作词（如 ${PLANNING_ACTION_VERBS.slice(0, 8).join('、')}…）。
- productActions：2～4 条独立可执行建议；每条 ≤${PLANNING_RECOMMENDATION_LIMITS.maxDetailLength} 字，须含动作词与功能点/流程节点/监控指标之一；禁止单条合并多条动作。
- serviceActions：0～2 条（按需）；标准同 productActions。
- 禁止润色或输出 clusterRootCause、verification、opportunities、evidenceNote、metrics、工单号；这些由规则引擎生成。
- 禁止：单量、占比、万投比、工单原文、根因长引号、IP/协查过程、处理意见复述。
- 若仍输出 details 字段，系统将忽略并改用 productActions/serviceActions。
- 信号类型侧重：${Object.entries(SIGNAL_TYPE_TEMPLATE)
    .map(([k, v]) => `${k}→${v.summaryHint}`)
    .join('；')}。`
}
