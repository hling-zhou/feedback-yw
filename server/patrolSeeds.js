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
  // ---- 11-18 补强（真实链路实证 #288：RAM 鉴权拒绝组被 order 11「HAVIP」接口名泛匹配劫持——
  //      有序匹配下强语义必须先于弱语义：鉴权语义全局最优先，任何接口通用。
  //      黄金回放 4097 反向校准：组 A 只收强拒绝词（Forbidden/Unauthorized/未授权/无权限/没有权限），
  //      不收「权限不足/需要授权」弱词——配额主因样本的日志附注常带角色权限措辞（先例 8月7日_西南-成都：
  //      CSLQUOTA 配额样本尾部带「服务关联角色权限不足」），弱词入组会把配额样本反劫持进权限类；
  //      用户拍板新增类目「权限&授权不足」----
  { order: 0, l1: '权限&授权不足', l2: 'RAM/子账号鉴权拒绝', productAction: '待处理',
    requiresAll: [
      ['Forbidden', 'Unauthorized', '未授权', '无权限', '没有权限'],
      ['RAM', '鉴权', '授权', '子用户', '角色', 'action', 'Action'],
    ] },
  { order: 1, l1: '业务冲突', l2: 'DNAT规则冲突', productAction: '待处理', anyOf: ['DNAT'] },
  // ---- 11-25 13:21 拍板（#115 误命中实证）：SDN 路由网段冲突错误码是业务冲突强语义，
  //      必须先于 order 6/7「锁定/冲突」泛词组——组 #115「CIDR_USED_IN_SDN_ROUTE」日志
  //      含「冲突」字样被锁定类劫持，真实语义是网段与既有路由重叠的业务规则拒绝。
  //      错误码级匹配精确度最高，插位 order 1.5（泛词规则之前全部让位）。----
  { order: 1.5, l1: '业务冲突', l2: '网段与路由冲突', productAction: '待处理',
    anyOf: ['CIDR_USED_IN_SDN_ROUTE', 'has overlapped with', 'SDN_ROUTE', '网段与既有路由冲突', '路由表规则目的地址'] },
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
  { order: 6, l1: '资源锁定&并发冲突', l2: '并发进行中', productAction: '—',
    orGroups: [['锁定'], ['冲突'], ['IS_LOCKING'], ['正处于', '绑定'], ['正处于', '解绑']],
    requiresAll: [['正在执行', '正在进行', '并发']] },
  { order: 7, l1: '资源锁定&并发冲突', l2: '锁定机制待查', productAction: '待处理',
    orGroups: [['锁定'], ['冲突'], ['IS_LOCKING'], ['正处于', '绑定'], ['正处于', '解绑']] },
  { order: 8, l1: '业务冲突', l2: '资源被他人占用', productAction: '待处理',
    anyOf: ['回收站', 'BELONGS_TO_OTHERS'] },
  { order: 9, l1: '参数无效&校验失败', l2: 'IP/资源ID/地址类', productAction: '—',
    requiresAll: [
      ['ipId', 'IP ID', '浮动IP', 'IP地址', 'IPv4地址', '可用区'],
      ['不存在', '无效', 'null', '已被占用', '不在子网', '为空', '空字符串', '命名规则'],
    ] },
  { order: 10, l1: '参数无效&校验失败', l2: '域名与比较类型成对', productAction: '—',
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
  // ---- 11-17 补强（真实 MCP 日志 64 兜底组语义分析产物；类目边界见 docs/DESIGN-API巡检.md §6.2）----
  // A桶 19 组：资源忙/操作进行中（无「锁定」字样的并发拒绝——时间维度：稍后重试可成功）
  { order: 18, l1: '资源锁定&并发冲突', l2: '资源忙/稍后重试', productAction: '—',
    anyOf: ['正在执行其他操作', '正在执行操作', '请稍后重试', '请稍后操作', '需要一段时间，请稍后',
            '正在进行绑定或者解绑', '不可以进行重复操作'] },
  // B桶 6 组：资源实例状态不满足（时间维度：不改状态必失败）——含 port 未绑定的资源侧状态
  { order: 19, l1: '资源状态异常', l2: '资源绑定状态不满足', productAction: '待处理',
    anyOf: ['已绑定资源，不支持', '未绑定资源', '不允许解绑', '默认网卡不允许'] },
  // C桶 4 组：产品级业务规则限制一类操作（对象=策略而非单实例）
  { order: 20, l1: '业务冲突', l2: '计费/订单策略限制', productAction: '待处理',
    anyOf: ['不支持续订', '不支持IP与关联的共享带宽一起退订', '一次性订单不支持'] },
  // D桶 4 组：请求侧传参缺失（PARAM_INCOMPLETE 码 + 必填/为空措辞）
  { order: 21, l1: '参数无效&校验失败', l2: '必填参数缺失', productAction: '—',
    anyOf: ['字段为必填参数', 'PARAM_INCOMPLETE', '的类型不能为空'] },
  // E桶 1 组：资源实例不存在（状态维度的极端——实例已消亡）
  { order: 22, l1: '资源状态异常', l2: '资源不存在', productAction: '—',
    requiresAll: [['路由器', 'port', '网络', '子网', 'IP', '实例', '资源', '负载均衡'],
                  ['不存在', '已删除', '已释放']] },
  { order: 99, l1: '其他&未归类', l2: '兜底', productAction: '待处理', isFallback: true },
]
