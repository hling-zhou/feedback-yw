/**
 * V2 规范 golden 用例 — 对齐 data/从单条工单提取客户请求内容挖掘需求痛点.md §1.4 / §2.4
 * SSOT：本文件；规则层断言关键词/长度，LLM 层断言 Jaccard ≥ 0.85
 */

/** @typedef {Object} V2CustomerRequestExample
 * @property {string} id
 * @property {string} category
 * @property {string} rawSnippet 客户原话（写入工单语料）
 * @property {string} expectedCustomerRequest LLM 精炼目标（§1.4）
 * @property {string[]} ruleMustInclude 规则层输出须包含（子串）
 * @property {string[]} [ruleMustExclude] 规则层输出不得包含
 * @property {Partial<{ rawText: string; handlingText: string; customerQuote: string }>} [inputOverride]
 */

/** @typedef {Object} V2PainPointExample
 * @property {string} id
 * @property {string} customerUtterance 客户原话
 * @property {string} expectedPainPoint LLM 精炼目标（§2.4）
 * @property {string[]} ruleMustInclude 规则层输出须包含（子串）
 * @property {string[]} [ruleMustExclude]
 */

/** @type {V2CustomerRequestExample[]} */
export const V2_CUSTOMER_REQUEST_EXAMPLES = [
  {
    id: 'cr-fault-01',
    category: '投诉-故障',
    rawSnippet:
      '云主机反复出现网络掉线，请拉群排查原因。前期曾经提交工单排查（工单号WO-12345）',
    expectedCustomerRequest: '云主机反复网络掉线，已提交工单但未解决。',
    ruleMustInclude: ['掉线', '网络'],
    ruleMustExclude: ['请网络组', '已返单'],
  },
  {
    id: 'cr-perf-02',
    category: '投诉-性能',
    rawSnippet:
      '分药店数据库客户端IP：222.*.*.216，访问云服务器36.*.*.200，白天正常，每天晚上8点-10点访问延迟大、业务卡顿。请尽快协助排查。',
    expectedCustomerRequest: '每天晚上8-10点，药店访问云服务器延迟大、卡顿。',
    ruleMustInclude: ['延迟', '卡顿'],
    ruleMustExclude: ['请网络组抓包'],
  },
  {
    id: 'cr-config-03',
    category: '投诉-配置',
    rawSnippet:
      'DDH上有两台云主机都在vpc0，vpc0与vpc1建立对等连接，两台云主机安全组规则一样，一台可以ping通vpc1下的ecs，一台ping不通',
    expectedCustomerRequest:
      '同VPC对等连接下，两台安全组相同的主机，一台无法ping通对端ECS。',
    ruleMustInclude: ['ping', '对等连接'],
    ruleMustExclude: [],
  },
  {
    id: 'cr-billing-04',
    category: '投诉-计费',
    rawSnippet:
      '账号下6条20M接入点为唐山的专线同时中断，可以ping通，但是无法进行数据传输。',
    expectedCustomerRequest: '6条唐山专线中断，ping通但无法传输数据。',
    ruleMustInclude: ['专线', 'ping'],
    ruleMustExclude: [],
  },
  {
    id: 'cr-quota-05',
    category: '咨询-配额',
    rawSnippet: '申请提升公网IP全局配额至300个，账号：ywsjqsm，当前20个，有效期到5月13日。',
    expectedCustomerRequest: '申请将公网IP全局配额从20提升至300。',
    ruleMustInclude: ['配额', '300'],
    ruleMustExclude: [],
  },
  {
    id: 'cr-light-ip-06',
    category: '咨询-轻载IP',
    rawSnippet: '华东-苏州申请轻载IP一个，邮件已审批，需订购10M带宽。',
    expectedCustomerRequest: '申请华东-苏州1个轻载IP，10M带宽。',
    ruleMustInclude: ['轻载', '苏州'],
    ruleMustExclude: [],
  },
  {
    id: 'cr-unblock-sell-07',
    category: '咨询-解售罄',
    rawSnippet: '天津资源池弹性公网IP售罄，申请解除售罄，需新订购IP-IPV4 数量：4个',
    expectedCustomerRequest: '天津资源池公网IP售罄，申请解售罄订购4个IP。',
    ruleMustInclude: ['售罄', '天津'],
    ruleMustExclude: [],
  },
  {
    id: 'cr-gray-08',
    category: '咨询-灰度权限',
    rawSnippet: '开通8:1灰度权限，取消CPU与IP比例限制，账号：test123',
    expectedCustomerRequest: '申请解除CPU与公网IP数量8:1限制。',
    ruleMustInclude: ['8:1', 'CPU'],
    ruleMustExclude: [],
  },
  {
    id: 'cr-progress-09',
    category: '咨询-进度',
    rawSnippet: '云专线订单MOP-O-26051124139158开通进度查询，客户着急使用',
    expectedCustomerRequest: '查询云专线订单开通进度。',
    ruleMustInclude: ['云专线', '进度'],
    ruleMustExclude: [],
  },
  {
    id: 'cr-howto-10',
    category: '咨询-操作步骤',
    rawSnippet: '如何绑定EIP到云主机？控制台找不到入口。',
    expectedCustomerRequest: '咨询云主机绑定EIP的操作方法。',
    ruleMustInclude: ['绑定', 'EIP'],
    ruleMustExclude: [],
  },
  {
    id: 'cr-ui-11',
    category: '体验-界面',
    rawSnippet: '控制台上删除按钮太难找了，找了5分钟都没找到',
    expectedCustomerRequest: '控制台删除按钮位置不合理，难以找到。',
    ruleMustInclude: ['删除', '控制台'],
    ruleMustExclude: [],
  },
]

/** @type {V2PainPointExample[]} */
export const V2_PAIN_POINT_EXAMPLES = [
  {
    id: 'pp-emotion-01',
    customerUtterance: '这个破系统太垃圾了，打开网页要等一分钟，真受不了',
    expectedPainPoint: '云主机控制台页面加载需一分钟。',
    ruleMustInclude: ['系统'],
    ruleMustExclude: ['太垃圾', '真无语'],
  },
  {
    id: 'pp-demand-02',
    customerUtterance: '希望增加批量删除功能',
    expectedPainPoint: '删除资源需逐个操作，效率低。',
    ruleMustInclude: ['删除', '效率'],
    ruleMustExclude: ['用户希望', '希望增加'],
  },
  {
    id: 'pp-quota-03',
    customerUtterance: '我申请了配额提升，为什么还不生效？急死了！',
    expectedPainPoint: '配额提升申请未按预期生效。',
    ruleMustInclude: ['配额', '生效'],
    ruleMustExclude: [],
  },
  {
    id: 'pp-network-04',
    customerUtterance: '网络时通时断，烦死了，严重影响业务',
    expectedPainPoint: '云主机网络连通性不稳定，业务受影响。',
    ruleMustInclude: ['时通时断', '网络'],
    ruleMustExclude: ['烦死了'],
  },
  {
    id: 'pp-limit-05',
    customerUtterance:
      '弹性公网IP已经增加配额了，但是在订购云堡垒机时还需要订购公网IP，提示您当前的订购触发了使用限制，无法订购新的弹性公网IP。',
    expectedPainPoint: '已提升配额，但订购云堡垒机时仍提示无法订购新IP，限制逻辑不明确。',
    ruleMustInclude: ['配额', '堡垒机'],
    ruleMustExclude: [],
  },
  {
    id: 'pp-ipv6-06',
    customerUtterance: '欠费恢复后，ipv6带宽被自动限制为原配置的80%',
    expectedPainPoint: '欠费恢复后IPv6带宽被限制为原值的80%。',
    ruleMustInclude: ['欠费恢复'],
    ruleMustExclude: [],
  },
  {
    id: 'pp-bandwidth-07',
    customerUtterance: '共享带宽配额受限，无法订购200M共享带宽',
    expectedPainPoint: '共享带宽配额不足，无法订购200M。',
    ruleMustInclude: ['共享带宽', '配额'],
    ruleMustExclude: [],
  },
  {
    id: 'pp-port-08',
    customerUtterance:
      '安全组规则已经放通53端口，但实际53端口请求进不来，怀疑骨干网拦截',
    expectedPainPoint: '安全组已放通53端口，但请求无法到达，疑似上游拦截。',
    ruleMustInclude: ['53', '端口'],
    ruleMustExclude: [],
  },
  {
    id: 'pp-dc-09',
    customerUtterance:
      '我单位通过云专线访问不了可用区二主机。跟了路由，看着到云侧后就走不到下一跳了。',
    expectedPainPoint: '云专线访问跨可用区主机路由中断。',
    ruleMustInclude: ['云专线', '路由'],
    ruleMustExclude: [],
  },
  {
    id: 'pp-doc-10',
    customerUtterance: '控制台上没有拨测任务列表的选项，帮助文档说有',
    expectedPainPoint: '控制台缺失帮助文档中描述的拨测任务列表功能。',
    ruleMustInclude: ['拨测', '控制台'],
    ruleMustExclude: [],
  },
]

/**
 * @param {V2CustomerRequestExample} example
 */
export function buildCustomerRequestTicketInput(example) {
  if (example.inputOverride) {
    return { customerQuote: '', ...example.inputOverride }
  }
  const body = `详细内容：首处理&客服组：客户反馈${example.rawSnippet}`
  return {
    rawText: body,
    handlingText: body,
    customerQuote: '',
  }
}
