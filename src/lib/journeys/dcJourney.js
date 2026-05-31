/**
 * 云专线（DC）用户旅程 — 基于实单 TOP 场景收束
 *
 * 设计依据：72 条云专线工单文本分析（开通/资源池/路由VPC/协查为主，纯故障占比低）
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const DC_USER_JOURNEY = [
  {
    id: 'discover',
    label: '方案与商务',
    description:
      '云专线工单多为开通与配置类；资费、能力规则、账单清单等咨询（报障类请结合请求场景=报障与恢复）',
    children: [
      {
        id: 'discover-pricing',
        label: '资费与价格咨询',
        description: '带宽改配费用、折扣、官网价格、事业部折扣等',
        keywords: [
          '资费',
          '价格',
          '费用',
          '多少钱',
          '原价',
          '折扣',
          '一键折扣',
          '集团折扣',
          '官网查不到价格',
          '数智事业部',
        ],
      },
      {
        id: 'discover-capability',
        label: '能力与规则咨询',
        description: '跨账号拉线、备份速率、是否支持某能力等方案咨询',
        keywords: [
          '咨询',
          '方案',
          '是否支持',
          '能不能',
          '同时拉两条',
          '上传速率',
          '100M带宽',
          '对象存储',
          '备份软件',
        ],
      },
      {
        id: 'discover-billing',
        label: '账单与清单',
        description: '计费清单、出账规则、冲销计算、加急要清单',
        keywords: ['账单', '计费清单', '出账', '如何计算', '冲销', '1月到3月', '清单', '加急要清单'],
      },
    ],
  },
  {
    id: 'provision',
    label: '开通与交付',
    description: '订购开通、加急、订单异常、资源池可用区、跨省落地协调',
    children: [
      {
        id: 'provision-order',
        label: '订购开通与加急',
        description: '开通、订购、审批、安装交付、汇聚专线权限',
        keywords: [
          '开通',
          '订购',
          '申购',
          '加急',
          '尽快开通',
          '业务开通审批',
          '安装交付',
          '汇聚专线',
          '订购权限',
        ],
      },
      {
        id: 'provision-order-fail',
        label: '订单状态异常',
        description: '开通失败但资源可用、未出账、MOP 订单状态',
        keywords: [
          '开通失败',
          '订单状态',
          '未出账',
          'MOP-T',
          'MOP-O',
          'EMOP',
          '资源可用',
          '订单编号',
        ],
      },
      {
        id: 'provision-pool',
        label: '资源池与可用区',
        description: '可用区选择、VPC 子网无法选择、资源池限制',
        keywords: [
          '资源池',
          '可用区',
          'AZ',
          '可用区2',
          '可用区4',
          '华东',
          '苏州',
          '郑州',
          '选不了',
          'VPC子网无法选择',
        ],
      },
      {
        id: 'provision-cross-province',
        label: '跨省与落地协调',
        description: '跨省专线、当地客响、落地机房端口',
        keywords: ['跨省', '青岛', '医保', '当地', '客响', '落地', '机房', '端口开放', '地市'],
      },
    ],
  },
  {
    id: 'access',
    label: '接入与配置',
    description: '子网白名单、路由互联、VPC 跨账号对接',
    children: [
      {
        id: 'access-subnet',
        label: '子网与白名单',
        description: '用户侧子网、白名单、子网冲突、VPC 变更',
        keywords: ['子网', '用户侧子网', '白名单', '子网冲突', 'VPC变更', '添加子网', '网段冲突'],
      },
      {
        id: 'access-routing',
        label: '路由与互联地址',
        description: '路由策略、默认互联地址、dummy IP、边界网关',
        keywords: ['路由', '路由策略', '互联地址', '默认互联', 'dummy', '边界网关', 'tracert', '网关地址'],
      },
      {
        id: 'access-vpc',
        label: 'VPC与跨账号对接',
        description: '跨账号/跨账户专线、同 VPC 子网、跨资源池路由',
        keywords: [
          '跨账号',
          '跨账户',
          'VPC',
          '跨资源池',
          '同一vpc',
          '用户子网相同',
          '云防火墙',
          '路由规则',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '运行与质量',
    description: '连通性、时延慢、丢包质量、带宽监控',
    children: [
      {
        id: 'operate-connect',
        label: '连通性异常',
        description: '不通、无法访问、ping 不通、访问云主机失败',
        keywords: [
          '不通',
          '无法访问',
          'ping不通',
          '无法ping',
          '连不上',
          '无法连通',
          '经常不通',
          '访问云主机',
        ],
      },
      {
        id: 'operate-slow',
        label: '时延慢与卡顿',
        description: '比公网慢、HIS 卡顿、上下行不对等',
        keywords: ['慢', '速度慢', '反应慢', '卡顿', '比公网慢', '不对等', '延迟差', 'HIS', '加载慢'],
      },
      {
        id: 'operate-quality',
        label: '丢包与链路质量',
        description: '丢包、波动、抖动、跨省链路质量',
        keywords: ['丢包', '跨省链路', '波动', '抖动', '链路质量', '质量差'],
      },
      {
        id: 'operate-monitor',
        label: '监控与带宽利用',
        description: '带宽超限、流量监控、利用率查询',
        keywords: ['带宽超限', '监控', '流量', '利用率', '超限情况'],
      },
    ],
  },
  {
    id: 'change',
    label: '变更与扩容',
    description: '带宽变更、移机割接、业务迁移双专线',
    children: [
      {
        id: 'change-bandwidth',
        label: '带宽变更',
        description: '扩容升配、500M改5G、带宽不足无法扩容',
        keywords: [
          '带宽变更',
          '扩容',
          '升配',
          '500M',
          '5G',
          '提速',
          '变更带宽',
          '带宽不足',
          '无法扩容',
        ],
      },
      {
        id: 'change-relocate',
        label: '移机搬迁与割接',
        description: '移机工单、勘察、割接保障、CNSO',
        keywords: ['移机', '搬迁', '割接', '移机工单', '勘察', 'CNSO', '云网一体', '节点流程', '割接保障'],
      },
      {
        id: 'change-migrate',
        label: '业务迁移与双专线',
        description: '资源池迁移、两条专线并存、退订旧线',
        keywords: ['迁移', '业务迁移', '两条专线', '同时存在', '退订杭州', '资源池迁移'],
      },
    ],
  },
  {
    id: 'incident',
    label: '故障与应急',
    description: '业务中断、协查根因定位',
    children: [
      {
        id: 'incident-outage',
        label: '业务中断',
        description: '中断、大面积不可用、应急',
        keywords: ['中断', '业务影响', '不可用', '大面积', '应急'],
      },
      {
        id: 'incident-investigate',
        label: '协查与根因',
        description: '协查、后台核实、抓包定位',
        keywords: ['协查', '排查', '根因', '抓包', '协助核实', '后台', '定位'],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与账务',
    description: '退订撤销欠费、暂停续订',
    children: [
      {
        id: 'release-cancel',
        label: '退订撤销与欠费',
        description: '退订、撤销订单、欠费恢复',
        keywords: ['退订', '撤销', '欠费', '恢复数据', '被退订', '冲突订单'],
      },
      {
        id: 'release-suspend',
        label: '暂停与续订',
        description: '专线暂停恢复、续订按钮',
        keywords: ['暂停', '恢复', '续订', '续费', '续订按钮', '跨账号实例'],
      },
    ],
  },
  {
    id: 'service',
    label: '服务与流程',
    description: '工单催办进度、投诉协同建群',
    children: [
      {
        id: 'service-progress',
        label: '工单进度与催办',
        description: '催进度、环节审批、省内传输开通',
        keywords: ['催', '进度', '环节', '省内传输网络开通', '审批未通过', '加急推进'],
      },
      {
        id: 'service-escalation',
        label: '投诉与协同',
        description: '建群、值班专家、客户经理加急',
        keywords: ['建群', '拉群', '值班专家', '客户经理', '加急', '协助处理', '烦请'],
      },
    ],
  },
]

export const DC_PRODUCT_MATCH = [
  '云专线',
  'dc',
  '专线',
  '跨省专线',
  'MPLS',
  '云互联',
  'CENO-SL',
  'CENO-NET',
  'MOP-T',
  'MOP-O',
  '云网一体',
  '客响',
  '勘察单',
  '移机工单',
  '汇聚专线',
  '用户侧子网',
  '互联地址',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const DC_NODE_SERVICE_MAP = {
  产品咨询: 'discover',
  产品使用问题: 'access',
  产品功能: 'discover',
  产品使用: 'operate',
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
export const DC_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  IP无法访问: { l1: 'operate', l2: 'operate-connect' },
  '可用性/连通性': { l1: 'operate', l2: 'operate-connect' },
  其他: { l1: 'operate', l2: 'operate-connect' },
}

export const DC_REQUEST_SCENE_PATH_MAP = {
  故障报修: '报障与恢复',
  报障: '报障与恢复',
  产品使用问题: '产品能力咨询',
}

export const DC_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性': '可用性/连通性故障',
}
