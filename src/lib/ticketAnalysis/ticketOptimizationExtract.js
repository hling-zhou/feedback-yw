import { getEstablishedActionDisplay } from '../../domain/establishedAction.js'
import { isValidRootCause } from '../journeyOptimizationLLM.js'

const GENERIC_SERVICE_RE = /工单保留|暂未回复|待客户|信息不全|拓扑|补充材料|空转/

const JOURNEY_PRODUCT_TIPS = {
  '绑定/解绑云资源': '优化控制台绑定流程与 IPv4/IPv6 双栈提示，降低绑定失败率。',
  公网访问不通:
    '在控制台增加网络路径诊断工具，自动检测安全组/ACL/路由配置，定位不通根因。',
  网络质量与丢包:
    '建立资源池网络质量看板，对金牌客户主动预警波动与时延劣化。',
  '退订/释放资源': '修复到期退订链路，避免「无法退订」需人工清理。',
  带宽升降配: '带宽变更订单与计费联动透明化，失败时给出可操作建议。',
  '访问控制与白名单':
    '在绑定成功页增加高频业务端口连通性一键检测，自动识别安全组拦截并提示放行。',
  连通性异常: '提供端到端连通性检测面板，展示路径各跳状态，辅助快速定位断点。',
  监听与端口配置:
    '增加监听器端口连通性实时检测，异常时自动关联安全组/ACL 配置差异。',
  安全组配置与异常:
    '在安全组变更页面增加影响范围预检，变更后自动触发受影响端口的连通性验证。',
  时延与链路质量:
    '建立链路质量监控看板，对时延/丢包超阈值自动告警并关联资源池状态。',
  远程连接异常:
    '在云主机详情页增加远程连接诊断工具，一键检测 SSH/RDP 连通性及安全组放行状态。',
  '创建/申购EIP':
    '在 EIP 创建失败时展示具体原因（配额不足/资源售罄/权限限制），并给出可操作替代方案。',
  订购开通与加急:
    '在订购流程关键节点增加状态追踪与超时预警，减少人工催办与流转等待。',
}

/**
 * @param {Object} input
 * @param {string} input.text
 * @param {string} [input.solutionSummary]
 * @param {string} [input.rootCause]
 * @param {string} [input.journeyL2]
 * @param {string} [input.painPoint]
 * @param {boolean} [input.fuzzy]
 * @returns {{ optimizationProduct: string; optimizationService: string; optimizationSuggestion: string }}
 */
export function extractTicketOptimizations(input) {
  const { text, solutionSummary, rootCause, journeyL2, painPoint, fuzzy } = input
  /** @type {string[]} */
  const product = []
  /** @type {string[]} */
  const service = []

  if (/无法复现|根因未明/.test(`${rootCause}${text}`)) {
    product.push('在「故障与应急-协查定位」环节加强链路追踪、资源池级监控与复现手册。')
  }

  if (journeyL2 && JOURNEY_PRODUCT_TIPS[journeyL2]) {
    product.push(JOURNEY_PRODUCT_TIPS[journeyL2])
  }

  if (/安全组|端口|8085|白名单|ACL/.test(`${text}${painPoint}`)) {
    product.push(
      '在绑定成功页增加「高频业务端口连通性一键检测」，自动识别安全组/ACL 拦截并提示一键放行。',
    )
  }

  if (/专线/.test(text) && /不通|中断|拓扑/.test(text)) {
    product.push('在专线控制台增加「链路状态自检与拓扑上传」引导页，降低报障时的信息缺失率。')
  }

  // —— 文本模式匹配：按关键词组合给诊断类建议（补充 journeyL2 未覆盖场景）——
  if (/丢包/.test(text) && /专线|带宽|链路/.test(text)) {
    product.push('建立专线链路质量监控与丢包告警，超阈值自动关联网络路径诊断。')
  }

  if (/中断|封堵|攻击|DDoS/.test(text) && /解封|恢复.*访问|恢复.*服务/.test(text)) {
    product.push(
      '在安全事件发生时自动生成流量审计报告，辅助客户快速获取安全证明并申请解封。',
    )
  }

  if (/无法访问|不能访问|访问不通/.test(text) && /安全组|白名单|ACL/.test(text)) {
    product.push(
      '在安全组配置页面增加端口连通性预检，变更后自动验证业务端口可达性。',
    )
  }

  if (/卡顿|慢/.test(text) && /CPU|资源争抢|性能/.test(text)) {
    product.push(
      '对通用型实例增加资源争抢监控与告警，检测到性能劣化时主动提示升配或迁移。',
    )
  }

  if (/日志|审计|追溯/.test(text) && /排查|定位|诊断/.test(text)) {
    product.push('增加操作日志与流量审计的实时检索能力，辅助快速定位故障根因。')
  }

  if (/告警|监控|预警/.test(text) && /不及时|没收到|未通知/.test(text)) {
    product.push('完善告警通知渠道与阈值自定义能力，确保关键事件多通道触达。')
  }

  if (product.length === 0 && isValidRootCause(rootCause || '')) {
    product.push(
      `针对「${journeyL2 || '该环节'}」高频根因，立项平台修复并建立验收标准与自助诊断能力。`,
    )
  }

  if (product.length === 0 && painPoint) {
    // 兜底建议按 rootCause/painPoint 内容分道，避免非配额场景给出含「配额/策略」的泛化话术
    const rcText = `${rootCause || ''}${painPoint}`
    if (/丢包|中断|不通|无法访问|连接失败|超时/.test(rcText)) {
      product.push(
        '增加网络连通性诊断工具与路径自检能力，辅助客户自助定位故障并减少重复报障。',
      )
    } else if (/安全组|ACL|路由|白名单|端口/.test(rcText)) {
      product.push(
        '在配置变更页面增加影响范围预检与连通性验证，降低配置错误导致的业务中断。',
      )
    } else if (/配额|到期|售罄|额度/.test(rcText)) {
      product.push(
        '完善控制台配额/有效期说明与到期预警，降低因配额到期导致的重复咨询。',
      )
    } else {
      product.push(
        '完善控制台报错提示与可操作 remediation 指引，降低重复咨询与协查成本。',
      )
    }
  }

  if (fuzzy || GENERIC_SERVICE_RE.test(text)) {
    service.push(
      '建立「信息不全工单」自动催办机制，超 4 小时未补充关键材料自动触发短信提醒，避免工单空转。',
    )
  }

  if (/协查|跨组|流转慢|等待/.test(text) && !service.length) {
    service.push('优化跨组协查 SLA 与升级路径，在工单内展示责任组与预计完成时间。')
  }

  const optimizationProduct = [...new Set(product)].slice(0, 3).join('\n')
  const optimizationService = [...new Set(service)].slice(0, 2).join('\n')
  const optimizationSuggestion = [optimizationProduct, optimizationService].filter(Boolean).join('\n')

  return { optimizationProduct, optimizationService, optimizationSuggestion }
}

/**
 * 单条工单「有效优化语料」（行动建议、措施收集等；**非**痛点聚类主文本）。
 *
 * 规则（需求 @20260601-1 §五）：
 * - **确立举措优先**：有 manualReviewOptimization 时仅返回该内容，自动产品/服务优化不参与。
 * - **不纳入**：产品组优化建议、设计师优化建议（上线后亦不得并入本函数）。
 *
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getEffectiveOptimization(record) {
  const manual = getEstablishedActionDisplay(record)
  if (manual) return { product: manual, service: '', combined: manual, source: 'manual' }

  const product = record?.optimizationProduct?.trim() || ''
  const service = record?.optimizationService?.trim() || ''
  const legacy = record?.optimizationSuggestion?.trim() || ''
  const combined = [product, service].filter(Boolean).join('\n') || legacy
  return { product, service, combined, source: 'auto' }
}
