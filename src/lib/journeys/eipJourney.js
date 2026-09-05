/**
 * 弹性公网 IP（EIP）用户旅程标签体系 — 虚拟定义版
 *
 * 设计依据：
 * - 移动云 EIP 标准生命周期：了解 → 开通 → 配置绑定 → 运行 → 变更 → 退订
 * - 工单「请求节点」格式：业务域--产品--服务类型--问题子类
 * - 样例工单高频场景：绑定失败、无法访问外网、带宽调整、退订释放、网络波动
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const EIP_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description:
      '客户了解弹性公网 IP 是什么、适用场景、与固定公网/共享带宽的区别，咨询规格、线路类型（BGP/单线）、IPv4/IPv6 及资费模型',
    children: [
      {
        id: 'discover-intro',
        label: '产品与规格咨询',
        description: '产品能力介绍、计费项说明、带宽规格选择、是否支持 IPv6、与竞品对比',
        keywords: ['产品咨询', '了解', '选型', '规格', '资费', 'IPv6', 'BGP', '产品介绍'],
      },
      {
        id: 'discover-billing',
        label: '计费模式咨询',
        description: '按带宽/按流量、包年包月、共享带宽、折扣券、账单项解释',
        keywords: ['计费', '折扣', '账单', '按量', '包年', '共享带宽', '扣费规则', '出账', '收取'],
      },
    ],
  },
  {
    id: 'provision',
    label: '开通与申领',
    description: '在控制台或 API 创建/申购弹性公网 IP，包含配额、审批、订单失败等开通环节问题',
    children: [
      {
        id: 'provision-create',
        label: '创建/申购 EIP',
        description: '新建弹性公网 IP、选择地域资源池、申请公网地址成功或失败',
        keywords: ['创建', '开通', '申购', '订购', '申请', '新建', '购买'],
      },
      {
        id: 'provision-quota',
        label: '配额与数量',
        description: '公网 IP / 带宽数量配额不足、提升配额、配额上限',
        keywords: ['配额', '配额不足', '配额不够', '配额没有增加', '提升配额', '上限', 'IP数量', '带宽配额'],
      },
      {
        id: 'provision-permission',
        label: '灰度与订购权限',
        description: '轻载、8:1、大带宽权限、解售罄、灰度与订购权限开通',
        keywords: [
          '轻载',
          '轻载IP',
          '灰度',
          '8:1',
          '大带宽权限',
          '解售罄',
          '订购权限',
          '开通权限',
          '控制台看不见',
          '看不见IP',
        ],
      },
    ],
  },
  {
    id: 'bind',
    label: '绑定与网络配置',
    description: '将 EIP 绑定到云主机、弹性网卡 ENI、NAT、负载均衡等；配置带宽、线路、安全组/ACL、白名单',
    children: [
      {
        id: 'bind-resource',
        label: '绑定/解绑云资源',
        description: 'EIP 绑定或解绑 ECS、网卡；绑定失败；空闲 IP；双栈 IPv4+IPv6 绑定异常',
        keywords: ['绑定', '解绑', '挂载', '关联', '云主机', 'ECS', '网卡', 'ENI', '绑定失败', '空闲'],
      },
      {
        id: 'bind-bandwidth',
        label: '带宽升降配',
        description: '调整公网带宽、限速、带宽包、订单无法操作、升配降配失败',
        keywords: ['带宽', '升降配', '调整带宽', '限速', '扩容', '降配', '订单无法操作'],
      },
      {
        id: 'bind-security',
        label: '访问控制与白名单',
        description: '安全组、端口开放、白名单、ACL、仅允许特定 IP 访问',
        keywords: ['白名单', '安全组', '端口', 'ACL', '开放', '8085', '防火墙'],
      },
    ],
  },
  {
    id: 'operate',
    label: '业务使用与连通',
    description:
      '已开通并用起来之后的报障与使用：单台不通、质量劣化、冻结停用，以及区域性大网导致的访问中断。EIP 不另设「故障与应急」',
    children: [
      {
        id: 'operate-access',
        label: '公网访问不通',
        description: '无法访问外网/特定网站、IP 无法访问、curl/ping 失败、外网不通；含区域性/大面积导致的访问中断',
        keywords: [
          '无法访问',
          '不通',
          '外网',
          '百度',
          'IP无法访问',
          '访问不了',
          '连不上',
          '时通时断',
          '打不开',
          '大面积',
          '区域性',
          '业务中断',
          '宕机',
        ],
      },
      {
        id: 'operate-remote',
        label: '远程连接异常',
        description: 'SSH/RDP 远程登录失败、跨云远程、内网远程、3389/22 端口',
        keywords: ['远程', '登录', 'SSH', 'RDP', '3389', '远程连接', '远程登录'],
      },
      {
        id: 'operate-quality',
        label: '网络质量与丢包',
        description: '延迟高、丢包、波动、卡顿、PING 不通、网络不稳定',
        keywords: ['丢包', '波动', '延迟', '不稳定', 'PING', '卡顿', '慢', '质量', '网络波动'],
      },
      {
        id: 'operate-traffic',
        label: '流量与监控查询',
        description: '流量查询、监控数据、某时段流量核实、计费流量争议',
        keywords: ['流量', '监控', '查询流量', '时段', '流量是否', '统计'],
      },
      {
        id: 'operate-suspend',
        label: '资源停用与冻结',
        description: '已开通且仍在使用的 EIP 被冻结/停用（客户不是来退订，也不是来问计费规则）',
        keywords: ['冻结', '被冻结', '停用', '被停用', '订单冻结'],
      },
    ],
  },
  {
    id: 'change',
    label: '变更与迁移',
    description: 'EIP 迁移、更换 IP、线路变更、双栈变更、跨资源池等非退订类变更',
    children: [
      {
        id: 'change-migrate',
        label: '迁移与更换',
        description: '更换公网 IP、迁移资源池、跨可用区',
        keywords: ['迁移', '更换', '切换', '转移'],
      },
      {
        id: 'change-spec',
        label: '线路/规格变更',
        description: 'BGP 改单线、IPv4 改 IPv6、移动 IP 类型变更',
        keywords: ['移动IP', 'IPv6', '线路', 'BGP', '变更'],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与释放',
    description: '到期退订、主动释放、欠费回收、删除资源失败',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订/释放资源',
        description: '退订 EIP、释放公网 IP、到期删除、注销',
        keywords: ['退订', '释放', '删除', '注销', '到期'],
      },
      {
        id: 'release-fail',
        label: '退订失败',
        description: '无法退订、提示内部系统错误、到期后无法删除、需协助清理',
        keywords: ['无法退订', '退订失败', '无法删除', '协助删除', '内部系统错误'],
      },
    ],
  },
  {
    id: 'service',
    label: '服务与体验',
    description: '非纯技术类：客服响应、流程时长、投诉升级、金牌客户专项服务等',
    children: [
      {
        id: 'service-complaint',
        label: '投诉与服务',
        description: '服务态度、响应慢、回访要求、升级投诉',
        keywords: ['投诉', '客服态度', '响应慢', '回访', '服务态度'],
      },
      {
        id: 'service-process',
        label: '流程与协同',
        description: '工单流转慢、跨部门协同、OP/后台处理时效',
        keywords: ['流转', '协同', '催单', '处理慢', '等待'],
      },
    ],
  },
]

export const EIP_PRODUCT_MATCH = [
  '弹性公网',
  '公网IP',
  '公网 IP',
  'EIP',
  'eip',
  '弹性ip',
  '移动IP',
  'IPv6带宽',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const EIP_NODE_SERVICE_MAP = {
  产品咨询: 'discover',
  产品使用问题: 'operate',
  产品功能: 'discover',
  产品使用: 'operate',
  故障报修: 'operate',
  报障: 'operate',
  其他: 'service',
}

/** 请求节点问题子类 → 旅程二级提示 */
export const EIP_NODE_ISSUE_MAP = {
  IP无法访问: { l1: 'operate', l2: 'operate-access' },
  '可用性/连通性': { l1: 'operate', l2: 'operate-access' },
  '公网IP绑定/解绑失败': { l1: 'bind', l2: 'bind-security' },
  产品功能: { l1: 'discover', l2: 'discover-intro' },
  产品咨询: { l1: 'discover', l2: 'discover-intro' },
  其他: { l1: 'operate', l2: 'operate-quality' },
}

/** 路径段 3 → 请求场景（精确） */
export const EIP_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

/** 路径段 4 → 问题类型（精确/别名） */
export const EIP_PROBLEM_TYPE_PATH_MAP = {
  '公网IP绑定/解绑失败': '配置与操作',
  '可用性/连通性': '可用性/连通性故障',
  IP无法访问: '可用性/连通性故障',
}
