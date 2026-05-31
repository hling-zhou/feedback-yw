/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */

/**
 * @typedef {Object} TicketLlmGoldenCase
 * @property {string} id
 * @property {Partial<FeedbackRecord>} record
 * @property {{ customerRequest: string; painPoint: string; productOptimizations: string[]; serviceOptimizations?: string[] }} llm
 */

const BASE = {
  product: '弹性公网 IP',
  productKey: 'eip',
  dataSourceType: 'complaint_ticket',
}

/** @type {TicketLlmGoldenCase[]} */
const CASES = [
  ['eip-access-01', '公网 80 端口无法访问', '安全组未放行 80 端口', '控制台安全组规则页增加端口连通性一键诊断与修复引导'],
  ['eip-access-02', '443 端口 HTTPS 不通', 'EIP 未绑定到云主机', '实例详情页展示 EIP 绑定状态与未绑定时的阻断提示'],
  ['eip-quota-01', '创建 EIP 提示配额已满', '默认 EIP 配额过低', '配额中心支持按产品批量申请与审批进度可视化'],
  ['eip-bind-01', 'EIP 绑定云主机报错', '目标实例已占用 EIP', '绑定流程前置校验并提示需解绑的冲突实例'],
  ['eip-latency-01', '晚高峰公网访问延迟高', '公网链路拥塞导致延迟升高', '控制台增加公网质量诊断与链路拥塞预警看板'],
  ['eip-ipv6-01', 'IPv6 地址无法 ping 通', '未开通 IPv6 带宽', 'IPv6 开通向导联动带宽购买与连通性自检'],
  ['eip-ddos-01', 'EIP 遭 DDoS 业务中断', '未启用 DDoS 防护', 'EIP 详情页默认展示 DDoS 防护状态与一键开启入口'],
  ['eip-release-01', '无法释放 EIP', '仍被 NAT 网关关联', '释放前展示关联资源清单与一键跳转解绑'],
  ['eip-bandwidth-01', '上传速率低于购买带宽', '实例侧限速与规格不一致', '变配流程同步校验实例带宽上限并给出冲突提示'],
  ['eip-floating-01', '主备切换后公网不通', '浮动 EIP 未随实例漂移', '高可用切换场景预检浮动 IP 漂移策略并给出修复建议'],
  ['eip-whitelist-01', '白名单配置后仍无法访问', '白名单源地址段配置错误', '白名单配置页增加源地址格式校验与生效范围预览'],
  ['eip-cross-region-01', '跨资源池绑定 EIP 失败', '跨资源池绑定不受支持', '绑定向导按实例资源池过滤可选 EIP 并提示跨池限制'],
  ['eip-api-01', 'OpenAPI 创建 EIP 权限不足', '子账号缺少 eip:create 权限', 'API 错误码映射缺少权限时的 IAM 策略推荐与一键授权'],
  ['eip-snat-01', '出网地址与预期 EIP 不一致', 'NAT SNAT 规则优先级错误', 'NAT 规则列表展示命中优先级与出网 EIP 预览'],
  ['eip-health-01', 'LB 健康检查持续失败', '后端安全组未放行探测源', 'LB 创建向导自动推荐健康检查所需安全组规则'],
  ['eip-monitor-01', '如何配置 EIP 流量告警', '缺少流量告警配置指引', 'EIP 详情页提供流量告警模板一键创建'],
  ['eip-console-01', '控制台找不到 EIP 管理入口', 'EIP 管理入口分散', '全局搜索支持 EIP 资源直达与管理操作快捷入口'],
  ['eip-billing-01', 'EIP 按量扣费高于预期', '突发流量峰值导致费用上升', '账单详情展示 EIP 流量峰值时段与费用构成拆解'],
  ['eip-renew-01', '包年 EIP 到期被释放', '到期释放策略提示不足', '到期前多渠道续费提醒并支持一键续费保留 IP'],
  ['eip-doc-01', '多 EIP 高可用架构咨询', '缺少官方架构指引', '控制台嵌入多 EIP 高可用场景化部署模板'],
].map(([id, req, pain, opt], index) => ({
  id,
  record: {
    ...BASE,
    id: `golden-${index + 1}`,
    dataSourceType: id.includes('billing') || id.includes('renew') || id.includes('doc') || id.includes('monitor') || id.includes('console')
      ? 'consultation_ticket'
      : 'complaint_ticket',
    rawText: `工单标题：${id}\n详细内容：${req}`,
    handlingText: `处理意见：已定位问题并完成协助，根因为${pain}。`,
    journeyL2: '公网访问不通',
    problemType: '网络连通',
  },
  llm: {
    customerRequest: `客户反馈${req}，希望尽快恢复业务访问。`,
    painPoint: `${pain}，影响客户公网业务可用性。`,
    productOptimizations: [opt],
    serviceOptimizations: id.includes('billing')
      ? ['计费争议工单接入流量明细自动核对流程']
      : undefined,
  },
}))

export const TICKET_LLM_GOLDEN_CASES = CASES
