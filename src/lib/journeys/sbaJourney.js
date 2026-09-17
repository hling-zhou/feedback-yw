/**
 * 场景化加速（SBA）用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：6 条场景化加速工单（2025-12 ~ 2026-02 投诉/咨询）
 * 高频：订购权限与带宽开通、能力咨询、退订。
 * 不设 service L1。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const SBA_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description:
      '了解场景化加速能力、适用场景、与CDN/云专线的区别、计费模式（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '能力与计费咨询',
        description: '场景化加速能力、数据快递、适用场景、计费咨询',
        keywords: [
          '功能使用咨询',
          '业务规则咨询',
          '是否支持',
          '场景化加速',
          '数据快递',
          '加速',
          'CDN',
          '计费',
          '资费',
          '产品咨询',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '订购与权限',
    description: '场景化加速订购、带宽权限开通、灰度',
    children: [
      {
        id: 'provision-permission',
        label: '订购与带宽权限',
        description: '订购权限开通、1G带宽订购权限、14天有效期、灰度',
        keywords: [
          '订购',
          '开通',
          '申购',
          '订购权限',
          '带宽',
          '1G',
          '带宽订购权限',
          '开通权限',
          '增加',
          '申请',
          '有效期',
          '14天',
          '烦请测试订购',
        ],
      },
    ],
  },
  {
    id: 'configure',
    label: '加速配置',
    description: '加速策略配置、源站/回源配置、域名接入',
    children: [
      {
        id: 'configure-policy',
        label: '加速策略配置',
        description: '加速策略、回源、域名接入、缓存规则',
        keywords: [
          '配置',
          '加速策略',
          '回源',
          '域名',
          '缓存',
          '源站',
          '接入',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与释放',
    description: '退订场景化加速、释放资源',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与释放',
        description: '退订场景化加速、释放资源、取消',
        keywords: ['退订', '取消', '释放', '退订/取消', '无法退订'],
      },
    ],
  },
]

export const SBA_PRODUCT_MATCH = [
  '场景化加速',
  'sba',
  'SBA',
  '数据快递',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const SBA_NODE_SERVICE_MAP = {
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
  其他: 'configure',
}

/** 请求节点问题子类 → 旅程二级提示 */
export const SBA_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  '场景化加速业务规则咨询': { l1: 'provision', l2: 'provision-permission' },
  '场景化加速退订/取消': { l1: 'release', l2: 'release-unsubscribe' },
  其他: { l1: 'configure', l2: 'configure-policy' },
}

export const SBA_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const SBA_PROBLEM_TYPE_PATH_MAP = {}
