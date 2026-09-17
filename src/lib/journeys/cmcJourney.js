/**
 * 云迁移中心（CMC）用户旅程 — 基于实单场景收束
 *
 * 校准依据：3 条云迁移中心工单（2025-12 ~ 2026-02 投诉/咨询）
 * 高频：迁移计划审批、产品使用咨询、帮助文档引导。
 * 不设 service L1。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const CMC_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description: '了解云迁移中心能力、迁移流程、是否需审批、自主操作（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '能力与使用咨询',
        description: '迁移能力、无需审批、自主操作、帮助文档、产品使用指引',
        keywords: [
          '功能使用咨询',
          '业务规则咨询',
          '是否支持',
          '云迁移',
          '迁移计划',
          '无需审批',
          '自主操作',
          '帮助中心',
          '产品使用',
          '使用该产品',
          '审批通过',
          '加急',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '迁移计划与审批',
    description: '发起迁移计划、审批进度、迁移时间安排、关机中断协调',
    children: [
      {
        id: 'provision-plan',
        label: '迁移计划与审批',
        description: '发起迁移计划、等待审批、审批加急、迁移时间确认、关机中断',
        keywords: [
          '迁移计划',
          '审批',
          '审批通过',
          '未有人处理',
          '加急',
          '关机',
          '业务中断',
          '迁移时间',
          '安排',
          '回个电话',
          '今天之内',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '迁移执行与故障',
    description: '迁移执行过程中的报障：迁移失败、中断、数据异常',
    children: [
      {
        id: 'operate-migration',
        label: '迁移执行异常',
        description: '迁移失败、迁移中断、数据异常、进度卡住',
        keywords: [
          '迁移失败',
          '中断',
          '数据异常',
          '卡住',
          '迁移过程',
          '执行',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '完成与清理',
    description: '迁移完成后的资源清理、迁移记录管理',
    children: [
      {
        id: 'release-cleanup',
        label: '完成与清理',
        description: '迁移完成后资源清理、迁移记录管理',
        keywords: ['完成', '清理', '迁移完成', '清理资源', '记录'],
      },
    ],
  },
]

export const CMC_PRODUCT_MATCH = [
  '云迁移中心',
  'cmc',
  'CMC',
  '云迁移',
  '迁移中心',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const CMC_NODE_SERVICE_MAP = {
  产品咨询: 'discover',
  产品功能: 'discover',
  产品使用问题: 'provision',
  产品使用: 'provision',
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
export const CMC_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  其他: { l1: 'provision', l2: 'provision-plan' },
}

export const CMC_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const CMC_PROBLEM_TYPE_PATH_MAP = {}
