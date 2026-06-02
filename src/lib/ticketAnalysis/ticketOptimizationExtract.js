import { isValidRootCause } from '../journeyOptimizationLLM.js'

const GENERIC_SERVICE_RE = /工单保留|暂未回复|待客户|信息不全|拓扑|补充材料|空转/

const JOURNEY_PRODUCT_TIPS = {
  '绑定/解绑云资源': '优化控制台绑定流程与 IPv4/IPv6 双栈提示，降低绑定失败率。',
  公网访问不通: '完善安全组/白名单自助排查工具，提供常见「不通」场景 playbook。',
  网络质量与丢包: '建立资源池网络质量看板，对金牌客户主动预警波动。',
  '退订/释放资源': '修复到期退订链路，避免「无法退订」需人工清理。',
  带宽升降配: '带宽变更订单与计费联动透明化，失败时给出可操作建议。',
  '访问控制与白名单': '在绑定成功页增加高频业务端口连通性一键检测，自动识别安全组拦截并提示放行。',
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

  if (product.length === 0 && isValidRootCause(rootCause || '')) {
    product.push(
      `针对「${journeyL2 || '该环节'}」高频根因，立项平台修复并建立验收标准与自助诊断能力。`,
    )
  }

  if (product.length === 0 && painPoint) {
    // 勿将 painPoint 原文包进举措：聚类聚合时仅前缀 100 字去重，易产生重复且未整合的多条建议
    product.push(
      '完善控制台报错提示、配额/策略说明与可操作 remediation 指引，降低重复咨询与协查成本。',
    )
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
  const manual = record?.manualReviewOptimization?.trim()
  if (manual) return { product: manual, service: '', combined: manual, source: 'manual' }

  const product = record?.optimizationProduct?.trim() || ''
  const service = record?.optimizationService?.trim() || ''
  const legacy = record?.optimizationSuggestion?.trim() || ''
  const combined = [product, service].filter(Boolean).join('\n') || legacy
  return { product, service, combined, source: 'auto' }
}
