/**
 * 云解析（CloudDNS）用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：72 条云解析工单（2025-12 ~ 2026-02 投诉/咨询）
 * 高频：解析记录管理、解析异常/无法解析、续订与订购权限、能力与计费咨询。
 * 不设 service L1：建群/操作指导类工单的实际问题均可归到 configure/operate/provision。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const CLOUDDNS_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description:
      '了解云解析能力、与内网DNS/域名注册的区别、计费模式、公网/内网解析边界（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '能力与计费咨询',
        description: '云解析支持公网/内网解析、与内网DNS区别、免费vs付费版本、测试账号订购',
        keywords: [
          '功能使用咨询',
          '业务规则咨询',
          '是否支持',
          '能不能',
          '公网解析',
          '内网解析',
          'VPC内解析',
          '内网DNS',
          '免费域名解析',
          '标准版',
          '测试账号',
          '灰度码',
          'BCDNS_ORDER_ACCESS',
          '可解析公网',
          'vpc内解析',
        ],
      },
      {
        id: 'discover-billing',
        label: '续订与计费咨询',
        description: '续订费用、计费模式、续订失败后切换免费版、超限折扣',
        keywords: [
          '计费咨询',
          '资费',
          '续订',
          '续订费用',
          '如何续订',
          '无法续订',
          '切换到免费',
          '超限折扣',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '订购与权限',
    description: '云解析订购、灰度权限、续订与订购流程、产品下架后的处理',
    children: [
      {
        id: 'provision-order',
        label: '订购与续订',
        description: '订购云解析、续订、产品下架后续订、订购页关闭、迁移到免费解析',
        keywords: [
          '订购',
          '开通',
          '申购',
          '续订',
          '无法续订',
          '续订不了',
          '订购页',
          '下架',
          '找不到续订',
          '切换到免费',
          '迁移到移动云',
          '域名转入已下线',
          '云解析接入',
        ],
      },
      {
        id: 'provision-permission',
        label: '灰度与订购权限',
        description: '灰度码开通、测试账号订购、订购权限申请',
        keywords: [
          '灰度',
          '灰度码',
          '订购权限',
          '开通权限',
          '申请订购',
          '测试账号',
          '内部账号',
        ],
      },
    ],
  },
  {
    id: 'configure',
    label: '解析记录管理',
    description: '添加/修改/删除解析记录、CNAME 冲突、主机头配置、转发规则、域名接入',
    children: [
      {
        id: 'configure-records',
        label: '解析记录配置',
        description: '添加 A/CNAME 记录、删除冲突记录、主机头 www/@、解析不生效、域名接入',
        keywords: [
          '解析记录',
          'CNAME',
          'A记录',
          '主机头',
          'www',
          '@',
          '添加解析',
          '删除冲突',
          '解析不生效',
          '域名接入',
          '解析配置',
          '添加一条',
          '可直接解析',
          '主机头为',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '解析异常与服务故障',
    description:
      '已配置后的报障：解析无法生效、域名访问旧 IP、域名被劫持、终端设备访问异常',
    children: [
      {
        id: 'operate-resolve-fail',
        label: '解析无法生效',
        description: '解析后无法访问、解析不生效、本地无法解析、ping 不通',
        keywords: [
          '无法解析',
          '解析不生效',
          '本地无法解析',
          '解析后访问',
          'ping不通',
          'ping通',
          '解析后终端',
          '访问还是旧IP',
          '旧IP',
          '域名解析后',
          'ssl解析',
          '无法解析域名',
        ],
      },
      {
        id: 'operate-hijack',
        label: '域名劫持与访问异常',
        description: '域名被劫持、区域访问异常、解析指向非预期 IP、物联网卡访问异常',
        keywords: [
          '劫持',
          '被劫持',
          '移动劫持',
          '区域访问',
          '新疆',
          '物联网卡',
          '抓包排查',
          '访问的还是旧IP',
          '终端设备',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与续订管理',
    description: '退订云解析、续订管理、退订后解析失效',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与续订',
        description: '退订云解析、续订管理、退订后解析失效、切换到免费解析',
        keywords: ['退订', '取消', '续订', '退订后', '切换到免费', '无法续订'],
      },
    ],
  },
  {
    id: 'change',
    label: '迁移与切换',
    description: '域名解析从其他注册商迁移到移动云、免费/付费版切换',
    children: [
      {
        id: 'change-migrate',
        label: '迁移与切换',
        description: '从华为云/阿里云迁移解析到移动云、免费版与付费版切换',
        keywords: [
          '迁移',
          '迁移到移动云',
          '从华为云',
          '从阿里云',
          '切换到免费',
          '域名转入',
          '解析迁移',
        ],
      },
    ],
  },
]

export const CLOUDDNS_PRODUCT_MATCH = [
  '云解析',
  'CloudDNS',
  'clouddns',
  'cloud_dns',
  '云解析服务',
  'DNS解析',
  '解析服务',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const CLOUDDNS_NODE_SERVICE_MAP = {
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
export const CLOUDDNS_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  '云解析功能使用咨询': { l1: 'discover', l2: 'discover-capability' },
  '云解析域名管理异常': { l1: 'operate', l2: 'operate-resolve-fail' },
  其他: { l1: 'operate', l2: 'operate-resolve-fail' },
}

export const CLOUDDNS_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const CLOUDDNS_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性': '可用性/连通性故障',
}
