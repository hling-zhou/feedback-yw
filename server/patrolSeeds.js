/**
 * API 巡检基础数据种子（docs/DESIGN-API巡检.md §5.2 / §6.2）。
 * 来源：样例数据全量机器扫描（92 统计行/8406 明细行，2026-11-07 核验）+ 指标清单修正。
 * 变更须经设计文档拍板；此处与 migration 标记共同保证部署环境自动灌入。
 */

/** @typedef {{ productKey: string, metricName: string, apiPath: string, bizType: string, inferred?: boolean }} PatrolApiRegistryItem */

/** 产品接口注册表种子（34 项 = A18 + B3 + C1(10) + C2(3)；A/B/C 分组见设计 §5.2） */
export const API_PATROL_API_REGISTRY_SEED = [
  // A. 样例统计表全集 18 项
  { productKey: 'eip', metricName: '绑定', apiPath: '/acl/v3/floatingip/bind', bizType: '绑定' },
  { productKey: 'eip', metricName: '解绑', apiPath: '/acl/v3/floatingip/unbind/{ipId}', bizType: '解绑' },
  { productKey: 'eip', metricName: '订购', apiPath: '/customer/v3/order/create/floatingip', bizType: '订购' },
  { productKey: 'eip', metricName: '退订', apiPath: '/customer/v3/order/delete', bizType: '退订' },
  { productKey: 'eip', metricName: '移入共享带宽', apiPath: '/customer/v3/sharedBandwidth/addExistFip', bizType: '更新' },
  { productKey: 'vpc', metricName: '创建子网', apiPath: '/customer/v3/network', bizType: '新增' },
  { productKey: 'vpc', metricName: '创建虚拟网卡', apiPath: '/customer/v3/port', bizType: '新增' },
  { productKey: 'vpc', metricName: 'HA VIP-绑定', apiPath: '/acl/v3/havip/bind', bizType: '绑定' },
  { productKey: 'vpc', metricName: 'HA VIP-解绑', apiPath: '/acl/v3/havip/unbind', bizType: '解绑' },
  { productKey: 'slb', metricName: '创建7层访问策略', apiPath: 'L7POLICY/CREATE', bizType: 'CREATE' },
  { productKey: 'slb', metricName: '更新7层访问策略', apiPath: 'L7POLICY/UPDATE', bizType: 'UPDATE' },
  { productKey: 'slb', metricName: '创建负载均衡', apiPath: 'LB/CREATE', bizType: 'CREATE' },
  { productKey: 'slb', metricName: '创建后端服务器', apiPath: 'MEMBER/CREATE', bizType: 'CREATE' },
  { productKey: 'slb', metricName: '删除后端服务器', apiPath: 'MEMBER/DELETE', bizType: 'DELETE' },
  { productKey: 'slb', metricName: '创建后端服务器组', apiPath: 'POOL/CREATE', bizType: 'CREATE' },
  { productKey: 'slb', metricName: '更新后端服务器组', apiPath: 'POOL/UPDATE', bizType: 'UPDATE' },
  { productKey: 'slb', metricName: '删除后端服务器组', apiPath: 'POOL/DELETE', bizType: 'DELETE' },
  { productKey: 'slb', metricName: '更新监听器', apiPath: 'LISTENER/UPDATE', bizType: 'UPDATE' },
  // B. 样例明细独有 3 项
  { productKey: 'vpc', metricName: '删除子网', apiPath: '/customer/v3/network/preDelete/{networkId}', bizType: '删除' },
  { productKey: 'slb', metricName: '删除负载均衡', apiPath: 'LB/DELETE', bizType: 'DELETE' },
  { productKey: 'slb', metricName: '续订负载均衡', apiPath: 'LB/RENEW', bizType: 'RENEW' },
  // C1. 指标清单补充 11 项（格式修正：补 /、单斜杠）
  { productKey: 'eip', metricName: '变更带宽', apiPath: '/customer/v3/order/change/floatingip', bizType: '变更' },
  { productKey: 'eip', metricName: '续订', apiPath: '/customer/v3/order/renew', bizType: '续订' },
  { productKey: 'eip', metricName: '移出共享带宽', apiPath: '/customer/v3/sharedBandwidth/removeFIP/{ipId}', bizType: '移出' },
  { productKey: 'vpc', metricName: '删除虚拟网卡', apiPath: '/customer/v3/port/preDelete/{portId}', bizType: '删除' },
  { productKey: 'vpc', metricName: '网卡-绑定云主机', apiPath: '/acl/v3/port/attachServer', bizType: '绑定' },
  { productKey: 'vpc', metricName: '网卡-解绑云主机', apiPath: '/acl/v3/port/{portId}/detachServer', bizType: '解绑' },
  { productKey: 'vpc', metricName: '网卡-批量配置辅助私网IP地址', apiPath: '/customer/v3/port/secondaryIp/assign/batch', bizType: '配置' },
  { productKey: 'vpc', metricName: '网卡-删除辅助私网IP地址', apiPath: '/customer/v3/port/secondaryIp/unassign', bizType: '删除' },
  { productKey: 'vpc', metricName: '创建HA VIP', apiPath: '/acl/v3/havip', bizType: '创建' },
  { productKey: 'vpc', metricName: '删除HA VIP', apiPath: '/acl/v3/havip/{havipId}', bizType: '删除' },
  // C2. ELB 语义映射推断 3 项（inferred=true，待真实推送校验）
  { productKey: 'slb', metricName: '创建监听器', apiPath: 'LISTENER/CREATE', bizType: 'CREATE', inferred: true },
  { productKey: 'slb', metricName: '删除监听器', apiPath: 'LISTENER/DELETE', bizType: 'DELETE', inferred: true },
  { productKey: 'slb', metricName: '退订负载均衡', apiPath: 'LB/UNSUBSCRIBE', bizType: 'UNSUBSCRIBE', inferred: true },
]

/**
 * 根因分类有序规则种子（17 条 + 兜底；docs/DESIGN-API巡检.md §6.2 v3 FINAL）。
 * match 结构：anyOf=单组 OR；requiresAll=组间 AND（组内 OR）；orGroups=组间 OR（组内 AND）。
 * 表达"（锁定 或 冲突 或 IS_LOCKING）或（正处于 且 含绑定/解绑）"用 orGroups（底稿规则 6 复合分支）。
 * @typedef {{
 *   order: number, l1: string, l2: string, productAction: '待处理' | '—',
 *   anyOf?: string[], allOf?: string[][], requiresAll?: string[][],
 *   isFallback?: boolean, enabled?: boolean
 * }} PatrolRootCauseRule
 */
export const API_PATROL_ROOT_CAUSE_RULES_SEED = [
  { order: 1, l1: '业务冲突', l2: 'DNAT规则冲突', productAction: '待处理', anyOf: ['DNAT'] },
  { order: 2, l1: '诊断能力缺口', l2: '日志缺失/无数据', productAction: '—',
    anyOf: ['缺少后续', '日志不完整', '日志查询异常', '无数据'] },
  { order: 3, l1: '诊断能力缺口', l2: '日志无ERROR/WARN', productAction: '—',
    anyOf: ['按 ERROR/WARN 条件过滤后未发现'] },
  { order: 4, l1: '配额不足', l2: 'HAVIP数量上限', productAction: '—',
    requiresAll: [
      ['配额'],
      ['超限', '用完', '不足', '用尽', '耗尽', '订购限制', '达到上限', 'QUOTA'],
      ['HAVIP', 'HA VIP', 'havip'],
    ] },
  { order: 5, l1: '配额不足', l2: '通用配额', productAction: '—',
    requiresAll: [
      ['配额', 'GLOBAL_BANDWIDTH'],
      ['超限', '用完', '不足', '用尽', '耗尽', '订购限制', '达到上限', 'QUOTA', 'GLOBAL_BANDWIDTH'],
    ] },
  { order: 6, l1: '资源锁定/并发冲突', l2: '并发进行中', productAction: '—',
    orGroups: [['锁定'], ['冲突'], ['IS_LOCKING'], ['正处于', '绑定'], ['正处于', '解绑']],
    requiresAll: [['正在执行', '正在进行', '并发']] },
  { order: 7, l1: '资源锁定/并发冲突', l2: '锁定机制待查', productAction: '待处理',
    orGroups: [['锁定'], ['冲突'], ['IS_LOCKING'], ['正处于', '绑定'], ['正处于', '解绑']] },
  { order: 8, l1: '业务冲突', l2: '资源被他人占用', productAction: '待处理',
    anyOf: ['回收站', 'BELONGS_TO_OTHERS'] },
  { order: 9, l1: '参数无效/校验失败', l2: 'IP/资源ID/地址类', productAction: '—',
    requiresAll: [
      ['ipId', 'IP ID', '浮动IP', 'IP地址', 'IPv4地址', '可用区'],
      ['不存在', '无效', 'null', '已被占用', '不在子网', '为空', '空字符串', '命名规则'],
    ] },
  { order: 10, l1: '参数无效/校验失败', l2: '域名与比较类型成对', productAction: '—',
    anyOf: ['hostNameCompareType', 'PolicyDomainName', 'l7PolicyDomainName', '要么都为空'] },
  { order: 11, l1: '业务冲突', l2: 'HAVIP绑定业务校验', productAction: '待处理',
    anyOf: ['HA VIP', 'havip', 'HAVIP'] },
  { order: 12, l1: '业务冲突', l2: '重复/批量删除异常', productAction: '待处理',
    anyOf: ['重复执行', 'deleteNet'] },
  { order: 13, l1: '诊断能力缺口', l2: '仅WARN结论不明', productAction: '—',
    requiresAll: [['WARN'], ['未明确', '可能']] },
  { order: 14, l1: '资源状态异常', l2: '负载均衡器本体', productAction: '待处理',
    requiresAll: [['负载均衡器'], ['正在更新', '状态不正常', '非ACTIVE', '更新中']] },
  { order: 15, l1: '资源状态异常', l2: '监听器', productAction: '待处理',
    requiresAll: [['监听器', 'listener'], ['不存在', '无效', '状态']] },
  { order: 16, l1: '资源状态异常', l2: '后端服务器组', productAction: '待处理',
    requiresAll: [['pool', '后端组', '负载均衡池'], ['不存在', '无效', '状态']] },
  { order: 17, l1: '业务冲突', l2: '绑定关系未解除', productAction: '待处理',
    anyOf: ['存在绑定关系', 'UNBIND_THEN_DELETE', '已绑定其他', 'NO_BOUND_EXCEPT_BANDWIDTH', '重复绑定'] },
  { order: 99, l1: '其他/未归类', l2: '兜底', productAction: '待处理', isFallback: true },
]
