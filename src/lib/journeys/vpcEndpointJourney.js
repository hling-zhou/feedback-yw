/**
 * VPC 终端节点（VPC Endpoint）用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：52 条 VPC终端节点工单（2026-01 ~ 2026-02 投诉/咨询）
 * 高频：能力与计费咨询、订购权限与灰度、开通配置验证、连通异常与资源失效。
 * 不设 service L1：所有工单的实际问题均可归到 configure/operate/provision。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const VPC_ENDPOINT_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description:
      '了解VPC终端节点能力、PrivateLink原理、计费模式（实例费+流量费）、与对等连接/云专线的区别（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '能力与计费咨询',
        description: '终端节点能力、PrivateLink原理、实例费与流量费、对等连接对比、是否支持跨资源池',
        keywords: [
          '功能使用咨询',
          '业务规则咨询',
          '是否支持',
          '终端节点',
          'PrivateLink',
          '私有连接',
          '对等连接',
          '跨资源池',
          '同资源池',
          '实例费',
          '流量费',
          '计费方式',
          '收取实例费用',
          '收取流量费用',
          '帮助中心',
          '产品咨询',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '订购与配额',
    description: '终端节点订购、灰度权限、可用区订购权限、配额、产品下架后订购',
    children: [
      {
        id: 'provision-permission',
        label: '灰度与订购权限',
        description: '灰度开通、可用区订购权限、苏州存量可用区、产品下架后续订、特邀用户',
        keywords: [
          '订购权限',
          '开通权限',
          '灰度',
          '灰度码',
          '可用区',
          '可用区一',
          '可用区二',
          '苏州',
          '存量可用区',
          '上架',
          '烦请上架',
          '开通订购权限',
          '上架苏州节点',
          '特邀用户',
          '仅针对特邀',
        ],
      },
      {
        id: 'provision-quota',
        label: '配额与数量',
        description: '终端节点配额、实例数量限制',
        keywords: ['配额', '配额不足', '提升配额', '上限', '实例数量'],
      },
    ],
  },
  {
    id: 'configure',
    label: '开通与配置验证',
    description: '创建终端节点、选择后端服务（云备份/云专线等）、配置验证、资源池匹配',
    children: [
      {
        id: 'configure-create',
        label: '创建与配置',
        description: '创建终端节点、选择后端服务、云备份智享版匹配、资源池提示无实例、配置验证',
        keywords: [
          '创建',
          '配置',
          '终端节点服务',
          '后端服务',
          '云备份',
          '智享版',
          '暂未订购',
          '资源池下',
          '前往订购',
          '正常显示',
          '登录验证',
          '烦请验证',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '连通异常与资源失效',
    description: '已配置后的报障：终端节点不通、资源失效、关联服务异常、账号受限无法订购',
    children: [
      {
        id: 'operate-connect',
        label: '连通性异常',
        description: '终端节点不通、无法访问后端服务、PrivateLink 连接异常',
        keywords: [
          '不通',
          '无法访问',
          '连接失败',
          '访问不了',
          '终端节点不通',
          'PrivateLink异常',
          '无法连通',
        ],
      },
      {
        id: 'operate-account',
        label: '账号受限',
        description: '订购时提示账号受限、集团高风险限制、需联系客户经理处理黑名单',
        keywords: [
          '帐号受限',
          '账号受限',
          '集团高风险',
          '黑名单',
          '客户经理',
          '黑名单管理员',
          '提示帐号受限',
          '无法订购',
        ],
      },
      {
        id: 'operate-resource',
        label: '资源失效',
        description: '终端节点资源失效、关联后端服务异常、退订后关联失效',
        keywords: [
          '资源失效',
          '关联失效',
          '退订关联',
          '后端服务异常',
          '资源不可用',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与关联失效',
    description: '退订终端节点、退订后关联资源失效、退订失败',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与释放',
        description: '退订终端节点、退订后关联资源失效、退订失败、无法退订',
        keywords: [
          '退订',
          '取消',
          '释放',
          '退订关联',
          '关联失效',
          '无法退订',
          '退订失败',
          '已退订',
          '还显示存在',
        ],
      },
    ],
  },
  {
    id: 'change',
    label: '变更与迁移',
    description: '终端节点变更后端服务、迁移资源池、变更配置',
    children: [
      {
        id: 'change-config',
        label: '变更与迁移',
        description: '变更后端服务、迁移资源池、变更配置',
        keywords: ['变更', '迁移', '更换', '切换', '变更配置', '资源池迁移'],
      },
    ],
  },
]

export const VPC_ENDPOINT_PRODUCT_MATCH = [
  'VPC终端节点',
  'VPC 终端节点',
  '终端节点',
  'vpc_endpoint',
  'PrivateLink',
  '私有连接',
  'VPCEP',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const VPC_ENDPOINT_NODE_SERVICE_MAP = {
  产品咨询: 'discover',
  产品功能: 'discover',
  产品使用问题: 'configure',
  产品使用: 'configure',
  业务方案支撑: 'discover',
  资源申请与开通: 'provision',
  报障与恢复: 'operate',
  故障报修: 'operate',
  报障: 'operate',
  费用与账务: 'discover',
  进度查询与协同: 'provision',
  其他: 'operate',
}

/** 请求节点问题子类 → 旅程二级提示 */
export const VPC_ENDPOINT_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  'VPC安装交付': { l1: 'provision', l2: 'provision-permission' },
  'VPC订购/开通': { l1: 'provision', l2: 'provision-permission' },
  'VPC退订/取消': { l1: 'release', l2: 'release-unsubscribe' },
  'VPC业务规则咨询': { l1: 'discover', l2: 'discover-capability' },
  其他: { l1: 'operate', l2: 'operate-connect' },
}

export const VPC_ENDPOINT_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const VPC_ENDPOINT_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性': '可用性/连通性故障',
}
