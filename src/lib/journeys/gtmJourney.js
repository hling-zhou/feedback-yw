/**
 * 全局流量管理（GTM）用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：9 条全局流量管理工单（2025-12 ~ 2026-02 投诉/咨询）
 * 高频：计费咨询、订购开通、退订异常、能力咨询。
 * 不设 service L1。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const GTM_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description:
      '了解全局流量管理能力、DNS智能解析、容灾调度、计费模式（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '能力与计费咨询',
        description: 'GTM能力、智能DNS解析、容灾切换、全局负载均衡、计费咨询',
        keywords: [
          '功能使用咨询',
          '业务规则咨询',
          '是否支持',
          '全局流量管理',
          'GTM',
          '智能DNS',
          '容灾',
          '调度',
          '全局负载',
          '计费咨询',
          '资费',
          '计费方式',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '订购与开通',
    description: 'GTM订购、开通、灰度权限',
    children: [
      {
        id: 'provision-order',
        label: '订购与开通',
        description: '订购GTM、开通权限、灰度',
        keywords: [
          '订购',
          '开通',
          '申购',
          '开通权限',
          '灰度',
          '订购权限',
          '申请',
        ],
      },
    ],
  },
  {
    id: 'configure',
    label: '解析与调度配置',
    description: 'GTM解析规则、地址池配置、健康检查、调度策略',
    children: [
      {
        id: 'configure-policy',
        label: '调度策略配置',
        description: '地址池配置、健康检查、调度策略、解析规则',
        keywords: [
          '配置',
          '地址池',
          '健康检查',
          '调度策略',
          '解析规则',
          '负载策略',
          '权重',
          '地域',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '运行与故障',
    description: '已配置后的报障：解析不生效、调度异常、容灾切换失败',
    children: [
      {
        id: 'operate-fail',
        label: '解析与调度异常',
        description: 'GTM解析不生效、调度异常、容灾未切换',
        keywords: [
          '不生效',
          '无法解析',
          '调度异常',
          '未切换',
          '容灾未切换',
          '解析失败',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与释放',
    description: '退订GTM、退订异常、已退订仍显示存在',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与释放',
        description: '退订GTM、退订后仍显示存在、退订失败、已退订',
        keywords: [
          '退订',
          '取消',
          '释放',
          '已退订',
          '还显示存在',
          '无法退订',
          '页面上显示',
          '已不需要退订',
          '没有退订',
        ],
      },
    ],
  },
]

export const GTM_PRODUCT_MATCH = [
  '全局流量管理',
  'gtm',
  'GTM',
  '全局流量',
  'GTM全局',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const GTM_NODE_SERVICE_MAP = {
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
export const GTM_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  '全局流量管理业务规则咨询': { l1: 'discover', l2: 'discover-capability' },
  其他: { l1: 'operate', l2: 'operate-fail' },
}

export const GTM_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const GTM_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性': '可用性/连通性故障',
}
