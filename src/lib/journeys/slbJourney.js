/**
 * 弹性负载均衡（SLB）用户旅程 — 基于实单 TOP 场景收束
 *
 * 设计依据：63 条 SLB 工单（开通/配额/上架、监听/转发/后端配置为主）
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const SLB_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与方案',
    description:
      'SLB 工单以开通、配额、监听/转发/后端配置为主；资费与能力咨询（报障类请结合请求场景=报障与恢复）',
    children: [
      {
        id: 'discover-pricing',
        label: '资费与计费咨询',
        description: '包月/按量、账单、退订计费规则',
        keywords: ['资费', '计费', '账单', '包月', '扣费', '多少钱', '计费咨询', '如何计费'],
      },
      {
        id: 'discover-capability',
        label: '能力与规格咨询',
        description: 'L4/L7、旗舰型、可用区、是否支持某特性',
        keywords: [
          '咨询',
          '是否支持',
          '规格',
          '旗舰型',
          '七层',
          '四层',
          '应用型',
          '网络型',
          'V4',
          'V6',
          '可用区',
        ],
      },
      {
        id: 'discover-architecture',
        label: '方案与架构咨询',
        description: '转发是否实时生效、多可用区部署等',
        keywords: ['方案', '架构', '怎么配', '转发策略修改', '实时生效', '业务方案'],
      },
    ],
  },
  {
    id: 'provision',
    label: '开通与上架',
    description: '实例创建订购、配额权限、规格上架交付、订单审核',
    children: [
      {
        id: 'provision-create',
        label: '实例创建与订购',
        description: '控制台/API 创建 SLB 实例',
        keywords: ['开通', '创建', '订购', '申购', '创建实例', '无法创建', 'API', '接口文档'],
      },
      {
        id: 'provision-quota',
        label: '配额与权限申请',
        description: '实例数、服务器组数量、访问控制组配额提升',
        keywords: [
          '配额',
          '配额不足',
          '提升配额',
          '上限',
          '提高到50',
          '提高到70',
          '服务器组数量',
        ],
      },
      {
        id: 'provision-permission',
        label: '灰度与订购权限',
        description: '灰度开通、订购权限、规格访问权限申请',
        keywords: ['灰度', '灰度权限', '订购权限', '开通权限', '申请权限'],
      },
      {
        id: 'provision-onboard',
        label: '产品上架与交付',
        description: '规格上架、安装交付、合规扫描',
        keywords: ['上架', '安装交付', '交付', '旗舰型上架', '端口关闭仍能扫到', '华南广州'],
      },
      {
        id: 'provision-order',
        label: '订单与审核异常',
        description: '退订待审核、开通失败、MOP 订单',
        keywords: ['退订', '等待审核', 'MOP-T', '订单编号', '开通失败', '订单状态'],
      },
    ],
  },
  {
    id: 'configure',
    label: '监听与转发配置',
    description: '监听、后端、健康检查、转发规则、会话/算法、证书',
    children: [
      {
        id: 'configure-listener',
        label: '监听与端口配置',
        description: '创建/修改监听、端口、协议',
        keywords: [
          '监听',
          '创建监听',
          '监听失败',
          '端口',
          '80',
          '443',
          'HTTP',
          'HTTPS',
          'TCP',
          'UDP',
        ],
      },
      {
        id: 'configure-backend',
        label: '后端与服务器组',
        description: '添加后端、服务器组、权重',
        keywords: ['后端', '服务器组', '后端服务器组', '添加后端', '不能添加', '绑定', '权重', 'member'],
      },
      {
        id: 'configure-health',
        label: '健康检查配置',
        description: '探测失败、异常后端摘除',
        keywords: ['健康检查', '探测', 'health', '异常后端', '检查间隔'],
      },
      {
        id: 'configure-forward',
        label: '转发策略与规则',
        description: 'URL/域名转发、规则优先级',
        keywords: ['转发', '转发策略', '规则', '路由', '域名转发', 'URL', '优先级', '修改转发'],
      },
      {
        id: 'configure-session',
        label: '会话保持与算法',
        description: '粘性、Cookie、轮询/加权/最小连接',
        keywords: ['会话保持', '粘性', 'cookie', '轮询', '加权', '最小连接', '负载算法'],
      },
      {
        id: 'configure-cert',
        label: '证书与HTTPS',
        description: '证书上传、SSL、TLS 卸载',
        keywords: ['证书', 'SSL', 'HTTPS', 'TLS', '证书绑定', '双向认证'],
      },
    ],
  },
  {
    id: 'access',
    label: '入口与访问控制',
    description: '公网/内网 VIP、访问控制组',
    children: [
      {
        id: 'access-network',
        label: '公网内网与VIP',
        description: '绑定 EIP、浮动 IP、内网 LB',
        keywords: ['VIP', '公网', '内网', 'EIP', '浮动IP', '公网IP', '访问地址'],
      },
      {
        id: 'access-acl',
        label: '访问控制与白名单',
        description: '访问控制组、IP 白名单',
        keywords: ['访问控制', '访问控制组', '白名单', 'ACL', 'IP白名单'],
      },
    ],
  },
  {
    id: 'operate',
    label: '业务访问与质量',
    description: '访问不通、慢响应与超时',
    children: [
      {
        id: 'operate-unavailable',
        label: '访问不通与错误码',
        description: '502/503/504、连接失败',
        keywords: [
          '不通',
          '无法访问',
          '502',
          '503',
          '504',
          '连接失败',
          '访问不了',
          '访问异常',
        ],
      },
      {
        id: 'operate-performance',
        label: '慢响应与超时',
        description: '延迟高、超时',
        keywords: ['慢', '超时', '延迟', '响应慢', '卡顿'],
      },
    ],
  },
  {
    id: 'incident',
    label: '故障与应急',
    description: '业务中断、协查定位',
    children: [
      {
        id: 'incident-outage',
        label: '业务中断',
        description: '大面积不可用、紧急验证',
        keywords: ['中断', '不可用', '业务影响', '紧急', '非常紧急'],
      },
      {
        id: 'incident-investigate',
        label: '协查与根因',
        description: '后台核实、抓包定位',
        keywords: ['协查', '排查', '根因', '抓包', '协助核实', '定位'],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与释放',
    description: '退订审核、删除释放',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与撤销',
        description: '包月退订、审核中订单',
        keywords: ['退订', '取消', '撤销', '包月', '等待审核'],
      },
      {
        id: 'release-delete',
        label: '实例删除与释放',
        description: '删除 SLB、释放资源',
        keywords: ['删除', '释放', '销毁', '下线'],
      },
    ],
  },
  {
    id: 'service',
    label: '服务与流程',
    description: '催办进度、API/接口问题',
    children: [
      {
        id: 'service-progress',
        label: '工单进度与催办',
        description: '催交付、审批节点',
        keywords: ['催', '进度', '环节', '加急', '审批'],
      },
      {
        id: 'service-api',
        label: 'API与接口问题',
        description: 'OpenAPI/SDK 调用异常',
        keywords: ['API', '接口', 'SDK', 'OpenAPI', '调用失败', '返回内容'],
      },
    ],
  },
]

export const SLB_PRODUCT_MATCH = [
  '弹性负载均衡',
  'SLB',
  'slb',
  '负载均衡',
  'ELB',
  '应用型负载均衡',
  '网络型负载均衡',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const SLB_NODE_SERVICE_MAP = {
  产品咨询: 'discover',
  产品功能: 'discover',
  产品使用问题: 'configure',
  产品使用: 'configure',
  业务方案支撑: 'discover',
  资源申请与开通: 'provision',
  报障与恢复: 'incident',
  故障报修: 'incident',
  报障: 'incident',
  费用与账务: 'discover',
  进度查询与协同: 'service',
  其他: 'service',
}

/** 请求节点问题子类 → 旅程二级提示 */
export const SLB_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  IP无法访问: { l1: 'operate', l2: 'operate-unavailable' },
  '可用性/连通性': { l1: 'operate', l2: 'operate-unavailable' },
  其他: { l1: 'configure', l2: 'configure-backend' },
}

export const SLB_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const SLB_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性': '可用性/连通性故障',
  IP无法访问: '可用性/连通性故障',
}
