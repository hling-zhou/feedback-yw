/**
 * 内网DNS（Private DNS）用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：31 条内网DNS工单（2026-01 ~ 2026-02 投诉/咨询）
 * 高频：绑定VPC、转发规则配置、PTR记录、解析异常/服务故障、能力咨询。
 * 不设 service L1：所有工单的实际问题均可归到 configure/operate/provision。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const PRIVATE_DNS_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与使用咨询',
    description:
      '了解内网DNS能力、与公网云解析区别、是否支持外部转发、VPC内私有域名解析（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '能力与使用咨询',
        description: '内网DNS能力介绍、不支持外部转发、VPC内私有域名映射、与云解析区别',
        keywords: [
          '功能使用咨询',
          '业务规则咨询',
          '是否支持',
          '内网DNS',
          '私有域名解析',
          'VPC环境',
          '安全隔离',
          '灵活可定制',
          '私有域名',
          'IP地址映射',
          '不支持外部转发',
          '外部转发',
          '可参考文档',
          '帮助中心',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '订购与绑定VPC',
    description: '内网DNS实例创建、订购、绑定VPC、安装交付',
    children: [
      {
        id: 'provision-bind-vpc',
        label: '订购与绑定VPC',
        description: '创建内网DNS实例、绑定VPC失败、订购权限、实例创建',
        keywords: [
          '订购',
          '开通',
          '创建',
          '绑定VPC',
          '绑定VPC失败',
          '内网DNS绑定',
          '实例',
          '订购权限',
          '安装交付',
        ],
      },
    ],
  },
  {
    id: 'configure',
    label: '转发规则与PTR配置',
    description: '转发规则配置、PTR记录、私有域名管理、强制转发',
    children: [
      {
        id: 'configure-forward',
        label: '转发规则与PTR',
        description: '强制转发规则、目标IP、PTR记录配置、私有域名管理、DNS代理转发',
        keywords: [
          '转发规则',
          '强制转发',
          '目标IP',
          'PTR',
          'PTR记录',
          'iam.cnpc',
          'dns代理',
          '代理转发',
          '私有域名',
          '域名管理',
          '配置',
        ],
      },
      {
        id: 'configure-records',
        label: '解析记录管理',
        description: '添加/修改/删除私有解析记录、域名映射',
        keywords: [
          '解析记录',
          'A记录',
          'CNAME',
          '添加记录',
          '修改记录',
          '删除记录',
          '域名映射',
          '私有解析',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '解析异常与服务故障',
    description: '已配置后的报障：解析不生效、无法访问、DNS服务异常、网络访问问题',
    children: [
      {
        id: 'operate-resolve-fail',
        label: '解析异常',
        description: '内网DNS解析不生效、私有域名无法解析、DNS服务器异常',
        keywords: [
          '无法解析',
          '解析不生效',
          '解析异常',
          '无法访问',
          '内网DNS异常',
          'DNS服务异常',
          '产品异常',
          '索赔',
        ],
      },
      {
        id: 'operate-network',
        label: '网络访问异常',
        description: '云主机网络访问问题、无法访问外部API、跨VPC访问异常',
        keywords: [
          '网络访问',
          '无法访问',
          'api.weixin.qq.com',
          '433端口',
          '云主机无法访问',
          '网络侧问题',
          '协助排查',
          '更换DNS',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与释放',
    description: '退订内网DNS、解除VPC绑定、删除实例',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与释放',
        description: '退订内网DNS、删除实例、解除VPC绑定',
        keywords: ['退订', '删除', '解除绑定', '释放', '取消'],
      },
    ],
  },
]

export const PRIVATE_DNS_PRODUCT_MATCH = [
  '内网DNS',
  'privateDNS',
  'private_dns',
  'PrivateDNS',
  '内网DNS服务',
  '私有DNS',
  'PDNS',
  'pdns',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const PRIVATE_DNS_NODE_SERVICE_MAP = {
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
export const PRIVATE_DNS_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  '内网DNS绑定VPC失败': { l1: 'provision', l2: 'provision-bind-vpc' },
  '内网DNS产品异常': { l1: 'operate', l2: 'operate-resolve-fail' },
  其他: { l1: 'operate', l2: 'operate-resolve-fail' },
}

export const PRIVATE_DNS_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const PRIVATE_DNS_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性': '可用性/连通性故障',
}
