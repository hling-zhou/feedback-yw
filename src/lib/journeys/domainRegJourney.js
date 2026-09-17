/**
 * 域名注册（Domain Registration）用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：507 条域名注册工单（2025-12 ~ 2026-02 投诉/咨询）
 * 高频：续订失败、域名过户/转入转出、解析与备案、账号受限/黑名单、退订注销。
 * service L1 仅保留「账号受限与黑名单」「工单进度与催办」，不设建群/操作指导
 * （建群只是处理手段，实际问题归到 provision/configure/operate 等环节）。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const DOMAIN_REG_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description:
      '了解域名注册产品能力、资费模型、转入转出规则、与云解析/备案的关系（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-pricing',
        label: '资费与订购咨询',
        description: '域名价格、续订费用、转入费用、折扣、订购渠道与页面入口',
        keywords: [
          '资费',
          '价格',
          '费用',
          '多少钱',
          '续订费用',
          '转入费用',
          '折扣',
          '订购咨询',
          '订购页',
          '购买',
          '怎么购买',
          '订购页关闭',
          '下架',
          '找不到续订',
          '开放市场',
          '云市场',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '续订与过户',
    description: '域名续订、过户、转入转出、自动续订管理、订购权限与上架',
    children: [
      {
        id: 'provision-renew',
        label: '续订与自动续订',
        description: '续订失败、收不到授权码、自动续订无法取消、续订按钮找不到、到期续订',
        keywords: [
          '续订',
          '续费',
          '自动续订',
          '取消自动续订',
          '授权码',
          '收不到授权码',
          '续订失败',
          '续订不了',
          '到期',
          '到期了',
          '续订按钮',
          '无法续订',
          '续订都失败',
        ],
      },
      {
        id: 'provision-transfer',
        label: '过户与转入转出',
        description: '域名过户、转入移动云、转出到其他注册商、账号间转移、过户材料',
        keywords: [
          '过户',
          '转入',
          '转出',
          '转移',
          '迁移',
          '转入域名',
          '转出到',
          '账号间转移',
          '域名转移',
          '转入到移动云',
          '接入到移动云',
          '转出限制',
          '域名转入已下线',
        ],
      },
      {
        id: 'provision-permission',
        label: '订购权限与上架',
        description: '集团账号才能订购、互联网账号不支持、灰度码、产品上架、省代表审批',
        keywords: [
          '订购权限',
          '开通权限',
          '上架',
          '烦请上架',
          '集团账号',
          '互联网账号',
          '灰度码',
          '省代表',
          '产品部审批',
          '特邀用户',
          '订购页面',
          '显示订购',
        ],
      },
    ],
  },
  {
    id: 'configure',
    label: '解析与备案',
    description: '域名解析记录管理、备案咨询、DNS 服务器配置、SSL 证书',
    children: [
      {
        id: 'configure-resolve',
        label: '解析记录管理',
        description: '添加解析记录、CNAME 冲突、A 记录、子域名创建、主机头配置、解析不生效',
        keywords: [
          '解析',
          '解析记录',
          'CNAME',
          'A记录',
          '子域名',
          '子域',
          '主机头',
          '@',
          'www',
          '添加解析',
          '删除冲突',
          '解析不生效',
          '无法解析',
          '解析后访问',
          'ssl解析',
          '本地无法解析',
          '域名解析后',
        ],
      },
      {
        id: 'configure-filing',
        label: '备案与注销',
        description: '域名备案咨询、备案注销材料、备案信息变更、备案审核进度',
        keywords: [
          '备案',
          '备案注销',
          '注销备案',
          '备案材料',
          '备案信息',
          '备案变更',
          '备案审核',
          '注销申请',
          '注销材料',
          '域名注销',
          '删除期',
          'cn域名',
          '非.cn域名',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '订单异常与账号受限',
    description: '已开通并使用中的报障：续订/订购订单异常、账号被黑名单限制、域名被劫持',
    children: [
      {
        id: 'operate-order',
        label: '订单异常',
        description: '续订订单失败、订购订单报错、订单状态异常、退订订单卡住',
        keywords: [
          '订单异常',
          '订单续订失败',
          '订单报错',
          '订单状态',
          '订单无法操作',
          '订单编号',
          '订单问题',
          '续订失败',
          '无法操作',
          '提示内部系统错误',
          '订单续订',
        ],
      },
      {
        id: 'operate-account',
        label: '账号受限与黑名单',
        description: '账号被集团黑名单限制、高风险库限制、长期欠费加黑、无法订购/续订',
        keywords: [
          '黑名单',
          '高风险',
          '被限制',
          '账号受限',
          '帐号受限',
          '加黑',
          '长期欠费',
          '集团黑名单',
          '高风险库',
          '无法订购',
          '无法续订',
          '提示帐号受限',
          '登录不了',
          '无法登录',
        ],
      },
      {
        id: 'operate-hijack',
        label: '域名劫持与异常',
        description: '域名被劫持、解析指向异常 IP、域名无法访问、区域访问异常',
        keywords: [
          '劫持',
          '被劫持',
          '移动劫持',
          '无法访问',
          '域名无法访问',
          '访问不了',
          '解析异常',
          '指向异常',
          '区域访问',
          '新疆地区',
          '测试地址',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与释放',
    description: '域名退订、注销释放、退费争议、退订失败',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与注销',
        description: '退订域名、提交注销、退费差额、主动注销后费用不支持退回',
        keywords: [
          '退订',
          '注销',
          '释放',
          '退费',
          '差额',
          '主动注销',
          '已付费',
          '不支持退回',
          '提交注销',
          '退订不了',
          '无法退订',
        ],
      },
    ],
  },
  {
    id: 'service',
    label: '服务与流程',
    description:
      '非纯技术类：账号受限需客户经理协调、工单催办进度；建群/操作指导的工单优先归到实际旅程环节',
    children: [
      {
        id: 'service-account',
        label: '账号受限与黑名单协同',
        description: '账号被集团黑名单/高风险库限制，需客户经理联系本省黑名单管理员处理',
        keywords: [
          '客户经理',
          '黑名单管理员',
          '联系客户经理',
          '集团高风险',
          '省代表',
          '协同处理',
          '本省',
        ],
      },
      {
        id: 'service-progress',
        label: '工单进度与催办',
        description: '催办审批进度、加急处理、等待审批结果',
        keywords: ['催', '进度', '审批', '加急', '等待', '催办', '审批未通过', '加急推进'],
      },
    ],
  },
]

export const DOMAIN_REG_PRODUCT_MATCH = [
  '域名注册',
  'domain_reg',
  '域名',
  '域名转入',
  '域名续订',
  'Domain',
  'domain',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const DOMAIN_REG_NODE_SERVICE_MAP = {
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
  其他: 'operate',
}

/** 请求节点问题子类 → 旅程二级提示 */
export const DOMAIN_REG_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-pricing' },
  产品功能: { l1: 'discover', l2: 'discover-pricing' },
  '域名注册订购/开通': { l1: 'provision', l2: 'provision-permission' },
  '域名注册业务变更': { l1: 'provision', l2: 'provision-transfer' },
  '域名注册功能使用咨询': { l1: 'configure', l2: 'configure-resolve' },
  '域名注册退订/取消': { l1: 'release', l2: 'release-unsubscribe' },
  '订单续订失败': { l1: 'operate', l2: 'operate-order' },
  其他: { l1: 'operate', l2: 'operate-order' },
}

export const DOMAIN_REG_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const DOMAIN_REG_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性': '可用性/连通性故障',
}
