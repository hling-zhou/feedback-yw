/**
 * 云组网（CC）用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：本系统 15 条 productKey=cc 工单（2026-04～05 投诉/咨询）
 * 高频：订购开通与审批、跨账号/VPC 组网配置、连通性与时延、退订销户、计费方案咨询。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const CC_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与方案',
    description:
      '了解云组网能力边界、跨云/跨账号组网方案、计费规则（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '能力与规则咨询',
        description: '跨云节点连通、VPC/专线/对象存储边界、云互联与专线并存规则',
        keywords: [
          '能不能连通',
          '是否可以',
          '对象存储',
          '不属于这个范畴',
          '云互联',
          '一端云互联',
          '另一端是专线',
          '同时访问',
          '合云',
          '怎么理解',
          '业务规则咨询',
          '功能使用咨询',
        ],
      },
      {
        id: 'discover-billing',
        label: '资费与计费咨询',
        description: '包年包月计费、收费场景、产品经理解释计费',
        keywords: [
          '计费',
          '收费场景',
          '包年',
          '包月',
          '资费',
          '多少钱',
          '如何计费',
        ],
      },
      {
        id: 'discover-architecture',
        label: '组网方案咨询',
        description: '包年加专线、两点组网拓扑、集团跨账号组网方案',
        keywords: [
          '包年的云组网不可以加专线',
          '不可以加专线',
          '方案咨询',
          '集团组网',
          '两点组网',
          '跨账号',
          '组网方案',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '开通与订购',
    description: '云组网实例订购、开通权限、合同/后台审批、订单状态与开通失败',
    children: [
      {
        id: 'provision-order',
        label: '订购开通与权限',
        description: '无法订购、希望开通权限、订购成功后无法互访、开通失败与退单重提',
        keywords: [
          '无法订购',
          '开通权限',
          '希望开通权限',
          '订购成功后无法互访',
          '无法互访',
          '开通失败',
          '退单重新提单',
          '无法退单',
          '已开通9条',
          '三条开通失败',
          '取消云组网产品',
          'BNOC-CN',
        ],
      },
      {
        id: 'provision-approval',
        label: '审批与开通进度',
        description: '合同审批、订单卡在开通中、后台审批开通',
        keywords: [
          '合同审批',
          '卡在开通中',
          '开通中',
          '后台审批开通',
          'BNOC-NET',
          '还没有订单号',
          '审批环节',
        ],
      },
      {
        id: 'provision-quota',
        label: '带宽与订购权限',
        description: '接入带宽提升、订购权限至 8G 等大带宽权限申请',
        keywords: [
          '带宽申请',
          '提升订购权限',
          '订购权限至8G',
          '接入带宽',
          '8G',
          '全局资源池',
        ],
      },
    ],
  },
  {
    id: 'configure',
    label: '组网配置与变更',
    description: '添加 VPC 节点、拓扑变更、跨账号组网状态、计费模式变更',
    children: [
      {
        id: 'configure-topology',
        label: '节点与拓扑变更',
        description: '添加 VPC、跨账号组网变更、业务变更、网段与节点调整',
        keywords: [
          '加一个vpc',
          '加一个VPC',
          '跨账号组网',
          '显示在变更中',
          '业务变更',
          '拓扑',
          '连接节点是vpc',
          '苏州可用区',
          '南昌可用区',
        ],
      },
      {
        id: 'configure-mode',
        label: '计费模式与规格变更',
        description: '包年转包月、带宽规格变更等配置类变更',
        keywords: [
          '包年转为包月',
          '包年转包月',
          '从包年转为包月',
          '带宽变更',
          '改带宽',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '运行与故障排障',
    description: '组网连通性异常、时延与带宽体验、订购后互访失败等现网问题',
    children: [
      {
        id: 'operate-connectivity',
        label: '连通性异常',
        description: 'ping 不通、telnet 不通、无法跨账号互访、负载均衡端口不通',
        keywords: [
          'ping不通',
          '无法ping',
          'telnet不通',
          '无法从',
          'ping通对端',
          '协助排查',
          '非骨干网问题',
          '负载均衡监听',
          '不通',
        ],
      },
      {
        id: 'operate-performance',
        label: '时延与带宽体验',
        description: '网络延迟高、带宽利用率与体验不符、丢包抖动',
        keywords: [
          '网络延迟很高',
          '延迟很高',
          'ping对端延迟',
          '一百多毫秒',
          '实时只用了10M',
          '40M带宽',
          '丢包',
          '抖动',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与释放',
    description: '退订、销户、退单与资源释放',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与销户',
        description: '退订云组网、销户单、变更中需退订、省侧资源占用回退',
        keywords: [
          '退订',
          '销户',
          '退订操作',
          '触发退单',
          '回退',
          '省侧占用资源',
          '退订/取消',
        ],
      },
    ],
  },
  {
    id: 'service',
    label: '服务与流程',
    description: '审批催办、建群协同、操作指导与文档',
    children: [
      {
        id: 'service-progress',
        label: '工单进度与催办',
        description: '合同审批催办、开通进度跟进、建群处理、协助排查跟进',
        keywords: [
          '帮忙过一下',
          '催办',
          '进度',
          '建群处理',
          '建群',
          '烦请协助处理',
          '协助处理',
        ],
      },
      {
        id: 'service-guide',
        label: '文档与操作指导',
        description: '帮助文档、操作步骤、包月退订流程指引',
        keywords: [
          '帮助文档',
          '操作指导',
          '怎么从包年',
          '只有退订相关',
          '引导',
          '教程',
        ],
      },
    ],
  },
]

export const CC_PRODUCT_MATCH = ['云组网', 'CC', 'cc', '云互联', 'BNOC', '两点组网', '集团组网']

/** 请求节点服务类型 → 旅程一级默认映射 */
export const CC_NODE_SERVICE_MAP = {
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
  进度查询与协同: 'service',
  其他: 'service',
}

/** 请求节点问题子类 → 旅程二级提示 */
export const CC_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  订购成功后无法互访: { l1: 'provision', l2: 'provision-order' },
  '可用性/连通性': { l1: 'operate', l2: 'operate-connectivity' },
  其他: { l1: 'configure', l2: 'configure-topology' },
}

export const CC_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const CC_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性故障': '可用性/连通性故障',
  配额与权限申请: '配额与权限申请',
  资源开通与创建: '资源开通与创建',
  退订与释放: '退订与释放',
}
