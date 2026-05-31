import { isGenericMeasure, isValidRootCause } from './journeyOptimizationLLM.js'
import { isNegativeSentiment } from './sentiment.js'
import {
  getConfiguredJourneyTips,
  getConfiguredProblemTypeTips,
} from './planningConfigLoader.js'
/**
 * @param {string} problemType
 * @param {string} [product]
 */
function problemTypePlaybookTips(problemType, product) {
  const configured = getConfiguredProblemTypeTips(problemType, product)
  if (configured.length) return configured
  return PROBLEM_TYPE_PLAYBOOK[problemType] || []
}

/**
 * 用户旅程业务优化知识库（举一反三，非工单回单复述）
 * key: 二级旅程 label
 */
const JOURNEY_BUSINESS_PLAYBOOK = {
  '产品与规格咨询': [
    '统一产品选型决策树：按场景（公网访问/混合云/合规）推荐 EIP 规格与线路类型，减少咨询转工单。',
    '在控制台增加「规格对比」与计费试算器，降低选型误解导致的后续投诉。',
  ],
  '计费模式咨询': [
    '账单项与控制台用量对齐展示，提供按带宽/按流量切换前的影响说明与预估。',
    '对折扣、共享带宽等复杂计费场景提供一页纸 FAQ 与典型账单样例。',
  ],
  '创建/申购 EIP': [
    '开通失败时给出可操作的错误码说明与自助重试路径，减少「系统错误」类工单。',
    '配额不足场景引导至配额申请流程，并展示各资源池剩余配额。',
  ],
  '权限及配额限制': [
    '建立配额预警与权限自检工具，在创建前拦截不可达订单。',
    '梳理 IAM/主子账号权限矩阵，控制台提示缺失权限项与配额申请入口。',
  ],
  '配额与权限': [
    '建立配额预警与权限自检工具，在创建前拦截不可达订单。',
    '梳理 IAM/主子账号权限矩阵，控制台提示缺失权限项。',
  ],
  '绑定/解绑云资源': [
    '优化绑定流程：明确 ECS/ENI/NAT 绑定差异，失败时展示依赖检查（网卡状态、空闲 IP、双栈）。',
    '提供绑定前自检清单（安全组、路由、带宽状态），降低绑定失败重复投诉。',
  ],
  '带宽升降配': [
    '带宽变更与计费联动可视化，变更失败时给出订单号与回滚建议。',
    '对升配未生效场景增加异步任务状态追踪与主动通知。',
  ],
  '访问控制与白名单': [
    '上线「外网不通」自助排查向导：依次检查安全组、ACL、白名单、端口、线路封禁。',
    '白名单变更支持变更预览与生效时间说明，避免客户误以为未生效。',
  ],
  '公网访问不通': [
    '产品侧：完善连通性诊断工具（端到端探测），输出根因分类（客户侧/平台侧/线路侧）。',
    '运营侧：沉淀 TOP 不通场景 playbook，一线按标准场景引导排查与修复。',
    '举一反三：对金牌/重保客户建立资源池级网络质量看板与主动预警。',
  ],
  '远程连接异常': [
    '明确 22/3389 等端口与安全组、白名单、运营商封禁的边界，提供端口探测能力。',
    '远程失败场景区分平台网络问题与客户 OS/应用问题，减少无效协查。',
  ],
  '网络质量与丢包': [
    '建立资源池出口质量监控，波动时段主动通知受影响客户。',
    '对跨运营商访问质量问题提供线路切换建议（BGP/单线）与 SLA 说明。',
  ],
  '流量与监控查询': [
    '流量统计口径（计费 vs 监控）在控制台统一说明，支持按小时导出对账。',
    '监控延迟场景说明数据刷新周期，避免「查不到流量」类误解工单。',
  ],
  '业务中断/不可用': [
    '重大故障建立标准化 War Room 流程：影响面评估、公告、根因、复盘对外口径。',
    '推动可复现问题的自动化回归用例，纳入版本发布门禁。',
  ],
  '协查与根因定位': [
    '强化链路追踪与抓包协作工具，缩短「无法复现」类工单闭环周期。',
    '根因未明工单必须输出后续跟踪项与产品缺陷单号，禁止仅以「观察」结案。',
  ],
  '迁移与更换': [
    '迁移工具化：支持 EIP 跨资源池/跨可用区迁移 checklist 与影响评估。',
    '更换 IP 场景提前提示 DNS/白名单/证书等关联变更项。',
  ],
  '线路/规格变更': [
    'IPv4/IPv6 双栈、BGP/单线变更提供变更窗口与回退方案说明。',
  ],
  '退订/释放资源': [
    '到期退订自动化链路巡检，避免「无法退订」需人工清理。',
    '释放前展示关联资源与欠费影响，减少误操作与纠纷。',
  ],
  '退订失败': [
    '修复到期退订与计费侧状态不同步问题，建立失败订单自动补偿任务。',
  ],
  '投诉与服务': [
    '金牌客户专项服务通道与 SLA，投诉类工单限时回访机制。',
  ],
  '流程与协同': [
    '跨 OP/后台协同时效 KPI 看板，超时自动升级。',
  ],
  '产品咨询': [
    '完善帮助中心与智能客服知识库，覆盖高频咨询以减少工单。',
  ],
  '开通配置': [
    '新用户引导任务：开通 → 绑定 → 连通性验证一站式向导。',
  ],
  '使用运维': [
    '日常运维场景沉淀最佳实践文档与巡检项。',
  ],
  '排障修复': [
    '故障复盘机制：同类问题 30 天内复发则触发产品专项改进。',
  ],
  '订购开通与加急': [
    '开通全流程可观测：订单 → 审批 → 施工 → 交付，异常节点自动告警与客户进度通知。',
    '加急开通 SLA 与资源池/落地协同机制标准化，控制台可查询真实排期与阻塞原因。',
  ],
  '订单状态异常': [
    '修复订单状态与资源/计费侧不同步问题，失败订单自动补偿与状态对齐任务。',
    'MOP/EMOP 订单异常建立自助诊断与一线处理 playbook。',
  ],
  '资源池与可用区': [
    '资源池/可用区可选性前置校验，不可选时给出替代方案与配额说明。',
    '跨省/跨 AZ 开通场景提供影响评估与配置向导。',
  ],
  '跨省与落地协调': [
    '跨省专线落地协调流程线上化，明确各地客响接口与 SLA。',
    '落地机房端口/链路开通进度对客户侧可视化。',
  ],
  '路由与 VPC 配置': [
    'VPC/子网/路由配置向导与冲突检测，减少配置错误导致的连通问题。',
    '跨 VPC 互通与专线接入场景提供标准拓扑模板与验收 checklist。',
  ],
  '链路质量与丢包': [
    '建立专线链路质量监控与主动预警，波动时段通知受影响客户。',
    '对跨运营商/跨省链路质量问题提供绕行与升级处理机制。',
  ],
  '协查与定位': [
    '强化链路追踪与抓包协作工具，缩短协查闭环周期。',
    '协查类工单必须输出平台侧/客户侧结论分类，禁止仅以「观察」结案。',
  ],
  '资费与价格咨询': [
    '资费/折扣规则在控制台与帮助中心统一说明，支持改配费用试算。',
  ],
  '能力与规则咨询': [
    '产品能力与限制（跨账号、备份速率等）结构化 FAQ，减少重复咨询转工单。',
  ],
  '监听与端口配置': [
    '控制台「创建监听」分步向导：协议/端口/证书校验，失败时给出错误码与依赖项（后端组、证书、配额）。',
    '监听变更支持生效时间与影响面说明，避免客户误以为配置未生效。',
  ],
  '后端与服务器组': [
    '后端组添加流程展示 ECS/ENI 状态、权重与健康检查联动，失败时输出不可添加原因与修复项。',
    '支持批量导入后端与权重预检，降低人工配置错误导致的 502/504。',
  ],
  '健康检查配置': [
    '健康检查提供协议/间隔/阈值模板，探测失败时区分后端异常与监听配置问题并给出诊断入口。',
  ],
  '转发策略与规则': [
    '转发规则优先级可视化与冲突检测，变更支持预览与回滚指引。',
  ],
  '会话保持与算法': [
    '会话保持与负载算法在控制台提供场景说明与推荐配置，减少误配导致的访问异常。',
  ],
  '证书与HTTPS': [
    '证书上传/绑定流程与过期预警，HTTPS 监听失败时提示证书链与端口占用检查项。',
  ],
  '公网内网与VIP': [
    'EIP/VIP 绑定流程明确公网/内网差异与依赖检查（带宽、安全组），失败给出可操作建议。',
  ],
  '访问不通与错误码': [
    '502/503/504 映射到监听/后端/健康检查/证书四类根因，提供端到端探测与修复建议。',
  ],
  '慢响应与超时': [
    '超时类工单区分后端性能与 SLB/线路问题，提供连接数、超时阈值与后端负载排查指引。',
  ],
  '订单与审核异常': [
    '退订/开通订单状态与资源侧对齐，审核中订单展示节点 SLA，异常订单自助诊断。',
  ],
  'API与接口问题': [
    'OpenAPI/SDK 常见错误码与参数校验说明，接口文档与控制台操作对齐并附调用样例。',
  ],
  '账单与清单': [
    '计费清单生成与导出流程透明化，加急场景提供标准 SLA 与进度查询。',
  ],
}

const PROBLEM_TYPE_PLAYBOOK = {
  '资源开通与创建': [
    '建立资源创建前预检与失败自愈指引，对资源不足/开通超时场景给出可执行 remediation 路径。',
  ],
  '配额与权限申请': [
    '建立配额预警、权限自检与申请引导一体化能力，创建前拦截不可达订单。',
    '配额不足场景引导至配额申请流程，并展示各资源池剩余配额。',
  ],
  '产品功能需求': [
    '建立需求 intake 与排期可视化机制，对客户功能诉求给出明确 roadmap 与交付窗口。',
    '在控制台/工单侧同步需求处理进度，减少「无反馈」类重复咨询。',
  ],
  '公网访问不通': [
    '完善连通性诊断工具（端到端探测），输出根因分类（客户侧/平台侧/线路侧）。',
    '沉淀 TOP 不通场景 playbook，一线按标准场景引导排查与修复。',
  ],
  '公网访问不通或不稳定、丢包': [
    '建立端到端链路质量探测与丢包定位工具，区分平台/线路/客户侧问题。',
    '对不稳定/丢包场景提供标准协查 playbook 与主动预警机制。',
  ],
  '网络质量与丢包': [
    '建立资源池出口质量监控，波动时段主动通知受影响客户。',
  ],
  '配置与操作': [
    '补齐控制台/API 对接配置向导与常见错误码说明，降低配置类重复咨询。',
    '对接失败场景提供依赖检查清单（权限、配额、网络就绪），缩短协查闭环。',
  ],
  '计费与账单': [
    '账单项与控制台用量对齐展示，复杂计费场景提供 FAQ 与典型账单样例。',
    '资费/折扣规则在控制台与帮助中心统一说明，支持改配费用试算。',
  ],
  '可用性/连通性故障': [
    '完善连通性诊断工具（端到端探测），输出根因分类（客户侧/平台侧/线路侧）。',
    '沉淀 TOP 不通场景 playbook，一线按标准场景引导排查与修复。',
    '梳理安全组/ACL/白名单配置边界，提供合规场景模板与权限自检工具，减少误配类咨询。',
  ],
  '性能问题': [
    '建立性能基线与链路质量探测，对慢/卡顿/丢包场景提供标准排查路径。',
  ],
  '界面与操作易用性': [
    '优化控制台关键路径交互与提示文案，对高频误操作场景增加引导与前置校验。',
  ],
  '退订与释放': [
    '梳理退订/释放依赖链路与阻塞原因展示，提供自助释放检查与失败 remediation 指引。',
  ],
  '产品功能咨询': [
    '结构化产品能力/规则 FAQ 与工单进度查询入口，减少重复咨询与信息不一致。',
  ],
  '人工服务与流程': [
    '优化工单流转 SLA 可视化与升级/回访机制，降低因响应时效引发的重复投诉。',
  ],
}

/** 旅程 label → playbook key（taxonomy 与知识库命名不一致时） */
const JOURNEY_PLAYBOOK_ALIASES = {
  '配额与权限申请': '配额与权限',
}

/**
 * @param {string} l2
 */
function resolveJourneyPlaybookAlias(l2) {
  return JOURNEY_PLAYBOOK_ALIASES[l2] || ''
}

/**
 * @param {string} l2
 * @param {string} [product]
 * @returns {string[]}
 */
function journeyPlaybookTips(l2, product) {
  const configured = getConfiguredJourneyTips(l2, product)
  if (configured.length) return configured
  return (
    JOURNEY_BUSINESS_PLAYBOOK[l2] ||
    JOURNEY_BUSINESS_PLAYBOOK[resolveJourneyPlaybookAlias(l2)] ||
    []
  )
}

const L1_PLAYBOOK = {
  '认知与选型': ['建立 EIP 产品价值与选型白皮书，售前/客服统一话术，减少选型阶段信息不一致。'],
  '开通与申领': ['开通全链路可观测：订单 → 资源创建 → 可绑定状态，失败自动告警与自愈。'],
  '开通与交付': [
    '开通全链路可观测：订单 → 审批 → 施工 → 交付，失败自动告警与客户通知。',
    '加急开通与跨省落地协同 SLA 标准化，阻塞原因对客户侧可见。',
  ],
  '方案与商务': [
    '资费/能力/账单类咨询知识库结构化，减少重复咨询与信息不一致。',
  ],
  '绑定与网络配置': ['将绑定+安全组+带宽配置合并为「网络就绪」一键检测，未通过则阻断交付。'],
  '业务使用与连通': ['连通性与质量类问题纳入产品质量指标，按资源池月度复盘 TOP 根因。'],
  '故障与应急': ['建设故障知识库与应急预案，同类故障复用处置模板，缩短 MTTR。'],
  '变更与迁移': ['变更类操作强制影响评估与回退预案，控制台变更前二次确认。'],
  '退订与释放': ['客户生命周期末端体验专项：退订、释放、欠费回收链路端到端治理。'],
  '服务与体验': ['服务类工单与产品缺陷分流，体验问题纳入产品 OKR 跟踪。'],
}

/**
 * @param {string} text
 */
function isTemporaryWorkaroundText(text) {
  return /临时方案|临时规避|暂时规避|workaround/i.test(text || '')
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 * @param {string} field
 */
export function topValues(items, field, limit = 5) {
  const map = new Map()
  for (const fb of items) {
    const v = fb[field]?.trim()
    if (!v) continue
    if (field === 'rootCause' && !isValidRootCause(v)) continue
    if (field === 'solutionSummary' && isTemporaryWorkaroundText(v)) continue
    const key = v.slice(0, 100)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }))
}

function aggregateOptimizationSuggestions(items) {
  const map = new Map()
  for (const fb of items) {
    const s = fb.optimizationSuggestion?.trim()
    if (!s || isGenericMeasure(s) || isTemporaryWorkaroundText(s)) continue
    const parts = s.split(/[。；;]/).map((p) => p.trim()).filter((p) => p.length > 12)
    for (const p of parts) {
      if (isGenericMeasure(p) || isTemporaryWorkaroundText(p)) continue
      const key = p.slice(0, 120)
      map.set(key, (map.get(key) || 0) + 1)
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([text, count]) => ({ text, count, source: '工单提炼' }))
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 * @param {string} l1
 * @param {string} l2
 */
export function synthesizeBusinessMeasures(items, l1, l2) {
  const product = items[0]?.product?.trim()
  /** @type {{ text: string; count?: number; source: string; priority: number }[]} */
  const measures = []
  const seen = new Set()

  const add = (text, source, priority = 1, count) => {
    const key = text.slice(0, 80)
    if (seen.has(key)) return
    seen.add(key)
    measures.push({ text, source, priority, count })
  }

  for (const m of aggregateOptimizationSuggestions(items)) {
    add(m.text, '工单提炼', 3, m.count)
  }

  for (const tip of journeyPlaybookTips(l2, product)) {
    add(tip, '环节 playbook', 2)
  }
  for (const tip of L1_PLAYBOOK[l1] || []) {
    add(tip, '阶段 playbook', 1)
  }

  const topPt = topValues(items, 'problemType', 1)[0]
  if (topPt?.text) {
    const ptTips = problemTypePlaybookTips(topPt.text, product)
    for (const tip of ptTips) {
      add(tip, '类型 playbook', 2)
    }
  }

  const rootCauses = topValues(items, 'rootCause', 3)
  if (rootCauses.length >= 1 && rootCauses[0].count >= 2) {
    add(
      `针对该环节高频平台/配置类根因，立项修复对应缺陷链路，并在控制台增加场景化自助诊断入口。`,
      '根因归纳',
      3,
      rootCauses[0].count,
    )
  }

  const problemTypes = topValues(items, 'problemType', 2)
  if (problemTypes[0]?.count >= items.length * 0.4 && items.length >= 3) {
    const pt = problemTypes[0]
    add(
      `为「${pt.text}」类问题建设标准化排查工具与一线 playbook，减少重复人工协查。`,
      '类型归纳',
      2,
    )
  }

  return measures
    .filter((m) => !isGenericMeasure(m.text))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8)
}

/**
 * 行动建议专用：与洞察工作台「业务优化举措」同源，排除工单原文/打标模板复述
 * @param {import('./types.js').FeedbackRecord[]} items
 * @param {string} l1
 * @param {string} l2
 */
export function synthesizePlanningMeasures(items, l1, l2) {
  const product = items[0]?.product?.trim()
  /** @type {{ text: string; count?: number; source: string; priority: number }[]} */
  const measures = []
  const seen = new Set()

  const add = (text, source, priority = 1, count) => {
    const key = text.slice(0, 80)
    if (seen.has(key)) return
    seen.add(key)
    measures.push({ text, source, priority, count })
  }

  for (const tip of journeyPlaybookTips(l2, product)) {
    add(tip, '环节 playbook', 4)
  }
  for (const tip of L1_PLAYBOOK[l1] || []) {
    add(tip, '阶段 playbook', 3)
  }

  const topPt = topValues(items, 'problemType', 1)[0]
  if (topPt?.text) {
    const ptTips = problemTypePlaybookTips(topPt.text, product)
    for (const tip of ptTips) {
      add(tip, '类型 playbook', 3)
    }
  }

  const rootCauses = topValues(items, 'rootCause', 3)
  const hasPlaybook = measures.some((m) => /playbook/.test(m.source))
  if (rootCauses.length >= 1 && rootCauses[0].count >= 2 && !hasPlaybook) {
    add(
      `针对该环节高频平台/配置类根因，立项修复并在控制台增加场景化自助诊断与预检能力。`,
      '根因归纳',
      2,
      rootCauses[0].count,
    )
  }

  const problemTypes = topValues(items, 'problemType', 2)
  if (problemTypes[0]?.count >= Math.max(2, items.length * 0.3) && items.length >= 2) {
    const pt = problemTypes[0]
    add(
      `为「${pt.text}」类问题建设标准化排查 playbook 与专项 backlog，纳入版本验收跟踪。`,
      '类型归纳',
      2,
    )
  }

  if (!measures.length && l2 && !/未知|未识别/.test(l2)) {
    add(
      `在「${l2}」环节完善自助排查/进度可视化能力，缩短协查闭环并降低重复投诉。`,
      '环节 playbook',
      1,
    )
  }

  return measures
    .filter((m) => !isGenericMeasure(m.text))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8)
}

/**
 * 用外部生成的举措覆盖环节数据
 * @param {ReturnType<typeof buildJourneyInsights>} stages
 * @param {string} l1
 * @param {string} l2
 * @param {{ text: string; source: string }[]} measures
 */
export function applyMeasuresToStage(stages, l1, l2, measures) {
  const stage = stages.find((s) => s.l1 === l1)
  if (!stage) return stages
  const formatted = measures.map((m) => ({ ...m, priority: 5 }))
  if (l2) {
    const child = stage.children.find((c) => c.l2 === l2)
    if (child) child.businessMeasures = formatted
  } else {
    stage.businessMeasures = formatted
  }
  return stages
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeyDefs
 */
export function buildJourneyInsights(items, journeyDefs) {
  /** @type {Map<string, { l1: string; description?: string; items: import('./types.js').FeedbackRecord[]; children: Map<string, { l2: string; description?: string; items: import('./types.js').FeedbackRecord[] }> }>} */
  const stageMap = new Map()

  for (const def of journeyDefs) {
    stageMap.set(def.label, {
      l1: def.label,
      description: def.description,
      items: [],
      children: new Map(
        def.children.map((c) => [c.label, { l2: c.label, description: c.description, items: [] }]),
      ),
    })
  }

  const unknown = {
    l1: '未识别环节',
    description: '',
    items: [],
    children: new Map(),
  }

  for (const fb of items) {
    const l1 = fb.journeyL1 || '未识别环节'
    const l2 = fb.journeyL2 || '未识别子环节'
    let stage = stageMap.get(l1)
    if (!stage) {
      if (l1 === '未识别环节') {
        stage = unknown
      } else {
        stage = {
          l1,
          description: '',
          items: [],
          children: new Map(),
        }
        stageMap.set(l1, stage)
      }
    }
    stage.items.push(fb)
    if (!stage.children.has(l2)) {
      stage.children.set(l2, { l2, description: '', items: [] })
    }
    stage.children.get(l2).items.push(fb)
  }

  const stages = [...stageMap.values()]
  if (unknown.items.length) stages.push(unknown)

  return stages
    .map((stage) => {
      const l1Items = stage.items
      const children = [...stage.children.values()]
        .filter((c) => c.items.length > 0)
        .map((child) => {
          const cItems = child.items
          const negCount = cItems.filter((f) => isNegativeSentiment(f.sentiment)).length
          return {
            l2: child.l2,
            description: child.description,
            count: cItems.length,
            negativePct: cItems.length ? Math.round((negCount / cItems.length) * 100) : 0,
            problemTypes: topValues(cItems, 'problemType'),
            rootCauses: topValues(cItems, 'rootCause'),
            ticketResponses: topValues(cItems, 'solutionSummary'),
            businessMeasures: synthesizeBusinessMeasures(cItems, stage.l1, child.l2),
            feedbackSamples: cItems.slice(0, 5).map((fb) => ({
              id: fb.id,
              ticketId: fb.ticketId,
              problemSummary: fb.problemSummary || fb.customerQuote,
              sentiment: fb.sentiment,
            })),
          }
        })
        .sort((a, b) => b.count - a.count)

      const negCount = l1Items.filter((f) => isNegativeSentiment(f.sentiment)).length

      return {
        l1: stage.l1,
        description: stage.description,
        count: l1Items.length,
        negativePct: l1Items.length ? Math.round((negCount / l1Items.length) * 100) : 0,
        businessMeasures: synthesizeBusinessMeasures(l1Items, stage.l1, ''),
        children,
      }
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
}

/**
 * @param {ReturnType<typeof buildJourneyInsights>} stages
 */
export function journeyChartData(stages) {
  return stages.map((s) => ({
    name: s.l1,
    fullName: s.l1,
    count: s.count,
    negativePct: s.negativePct,
  }))
}
