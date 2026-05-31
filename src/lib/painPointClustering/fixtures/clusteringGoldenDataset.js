/**
 * M2-4 golden 数据集：固定 id / 痛点 / 严重度，用于 Top10 Kendall τ 回归。
 * 勿使用 random UUID。
 */

const PRODUCT_EIP = '弹性公网 IP'
const PRODUCT_VPC = 'VPC'

/** @typedef {import('../../types.js').FeedbackRecord} FeedbackRecord */

/**
 * @param {string} id
 * @param {Partial<FeedbackRecord>} overrides
 * @returns {FeedbackRecord}
 */
function rec(id, overrides = {}) {
  return {
    id,
    ticketId: `WO-${id}`,
    source: '工单',
    rawText: 'golden fixture',
    createdAt: '2025-06-15T10:00:00Z',
    importMonth: '2025-06',
    dataSourceType: 'complaint_ticket',
    product: PRODUCT_EIP,
    productKey: 'eip',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    sentiment: 'negative',
    urgencyLevel: 'high',
    ...overrides,
  }
}

/** @type {FeedbackRecord[]} */
export const CLUSTERING_GOLDEN_RECORDS = [
  // 高优先级：可用性 / 连通 — 6+5 条
  ...['a', 'b', 'c', 'd', 'e', 'f'].map((s, i) =>
    rec(`eip-conn-${i}`, {
      painPoint: '公网IP无法ping通外网连接失败',
      problemType: '可用性/连通性故障',
      journeyL1: '业务使用与连通',
      sentiment: i % 2 === 0 ? 'strong_negative' : 'negative',
    }),
  ),
  ...['a', 'b', 'c', 'd', 'e'].map((s, i) =>
    rec(`eip-sg-${i}`, {
      painPoint: '安全组规则未放行导致公网端口无法访问',
      problemType: '配置与操作',
      journeyL1: '绑定与网络配置',
      journeyL2: '安全组配置',
    }),
  ),
  // 性能 — 5 条
  ...['a', 'b', 'c', 'd', 'e'].map((s, i) =>
    rec(`eip-bw-${i}`, {
      painPoint: '带宽超限导致网速很慢无法正常使用',
      problemType: '性能问题',
      journeyL1: '业务使用与连通',
      sentiment: 'strong_negative',
    }),
  ),
  // 绑定失败 — 4 条
  ...['a', 'b', 'c', 'd'].map((s, i) =>
    rec(`eip-bind-${i}`, {
      painPoint: '弹性公网IP绑定云主机失败报错',
      problemType: '资源开通与创建',
      journeyL1: '绑定与网络配置',
    }),
  ),
  // 计费 — 4 条
  ...['a', 'b', 'c', 'd'].map((s, i) =>
    rec(`eip-bill-${i}`, {
      painPoint: '账单多出未知流量费用要求退赔',
      problemType: '计费与账单',
      journeyL1: '方案与商务',
      journeyL2: '账单查询',
    }),
  ),
  // NAT — 4 条
  ...['a', 'b', 'c', 'd'].map((s, i) =>
    rec(`eip-nat-${i}`, {
      painPoint: 'NAT网关端口映射配置后不生效',
      problemType: '配置与操作',
      journeyL1: '绑定与网络配置',
    }),
  ),
  // EIP 漂移 — 4 条
  ...['a', 'b', 'c', 'd'].map((s, i) =>
    rec(`eip-drift-${i}`, {
      painPoint: 'EIP漂移后业务中断无法自动恢复',
      problemType: '可用性/连通性故障',
      journeyL1: '故障与应急',
    }),
  ),
  // 控制台 — 3 条
  ...['a', 'b', 'c'].map((s, i) =>
    rec(`eip-ui-${i}`, {
      painPoint: '控制台找不到弹性公网IP绑定入口',
      problemType: '界面与操作易用性',
      journeyL1: '开通与申领',
      sentiment: 'mild_negative',
    }),
  ),
  // 共享带宽 — 4 条
  ...['a', 'b', 'c', 'd'].map((s, i) =>
    rec(`eip-shared-${i}`, {
      painPoint: '共享带宽包限速策略异常导致丢包',
      problemType: '性能问题',
      journeyL1: '业务使用与连通',
    }),
  ),
  // 退订 — 3 条
  ...['a', 'b', 'c'].map((s, i) =>
    rec(`eip-unsub-${i}`, {
      painPoint: '退订弹性公网IP后仍继续扣费',
      problemType: '退订与释放',
      journeyL1: '退订与释放',
    }),
  ),
  // 低价值（应剔除，不进 Top10）
  ...['a', 'b'].map((s, i) =>
    rec(`eip-quota-${i}`, {
      painPoint: '申请提升带宽配额上限',
      problemType: '配额与权限申请',
      journeyL1: '开通与申领',
    }),
  ),
  // 咨询来源 — 相似痛点 3 条
  ...['a', 'b', 'c'].map((s, i) =>
    rec(`eip-consult-${i}`, {
      dataSourceType: 'consultation_ticket',
      painPoint: '咨询公网IP无法访问如何排查',
      problemType: '产品功能咨询',
      journeyL1: '业务使用与连通',
      sentiment: 'neutral',
    }),
  ),
  // 第二产品 VPC — 6 条（多产品场景）
  ...['a', 'b', 'c'].map((s, i) =>
    rec(`vpc-route-${i}`, {
      product: PRODUCT_VPC,
      productKey: 'vpc',
      painPoint: 'VPC路由表配置错误导致子网不通',
      problemType: '配置与操作',
      journeyL1: '绑定与网络配置',
    }),
  ),
  ...['a', 'b', 'c'].map((s, i) =>
    rec(`vpc-peer-${i}`, {
      product: PRODUCT_VPC,
      productKey: 'vpc',
      painPoint: '对等连接建立失败无法跨VPC互通',
      problemType: '可用性/连通性故障',
      journeyL1: '业务使用与连通',
    }),
  ),
]

export const CLUSTERING_GOLDEN_PRODUCTS = [PRODUCT_EIP, PRODUCT_VPC]
