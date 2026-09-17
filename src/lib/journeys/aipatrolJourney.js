/**
 * AI巡考服务（AIPatrol）用户旅程 — 基于实单场景收束
 *
 * 校准依据：2 条AI巡考服务工单（2025-12 ~ 2026-02 投诉/咨询）
 * 高频：产品能力咨询、订购开通。
 * 不设 service L1。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const AIPATROL_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description: '了解AI巡考服务能力、适用场景、计费模式（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '能力与计费咨询',
        description: 'AI巡考能力、巡考场景、计费咨询',
        keywords: [
          '功能使用咨询',
          '业务规则咨询',
          '是否支持',
          'AI巡考',
          '巡考',
          '智能巡考',
          '计费',
          '资费',
          '产品咨询',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '订购与开通',
    description: 'AI巡考服务订购、开通、权限',
    children: [
      {
        id: 'provision-order',
        label: '订购与开通',
        description: '订购AI巡考、开通权限、订购流程',
        keywords: [
          '订购',
          '开通',
          '申购',
          '开通权限',
          '订购权限',
          '申请',
          '开通',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '运行与故障',
    description: '使用过程中的报障：巡考异常、服务不可用',
    children: [
      {
        id: 'operate-fail',
        label: '运行异常',
        description: 'AI巡考服务异常、巡考失败、服务不可用',
        keywords: [
          '异常',
          '故障',
          '不可用',
          '巡考失败',
          '无法使用',
        ],
      },
    ],
  },
]

export const AIPATROL_PRODUCT_MATCH = [
  'AI巡考',
  'aipatrol',
  'AIPatrol',
  'AIPATROL',
  '巡考服务',
  '智能巡考',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const AIPATROL_NODE_SERVICE_MAP = {
  产品咨询: 'discover',
  产品功能: 'discover',
  产品使用问题: 'operate',
  产品使用: 'operate',
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
export const AIPATROL_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  其他: { l1: 'operate', l2: 'operate-fail' },
}

export const AIPATROL_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const AIPATROL_PROBLEM_TYPE_PATH_MAP = {}
