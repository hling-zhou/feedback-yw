/**
 * 云端口（Cloud Port）用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：84 条云端口工单（2025-12 ~ 2026-02 投诉/咨询）
 * 高频：订购权限与灰度、承载网连通、子网变更与搬迁、退订与释放。
 * 不设 service L1：所有"建群/客户经理跟进"工单的实际问题均可归到 provision/operate/release。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const CLOUD_PORT_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description:
      '了解云端口能力、与云专线/承载网的关系、计费模式、适用场景（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '能力与计费咨询',
        description: '云端口能力、专线配置是否收费、承载网概念、端口规格、演示需求',
        keywords: [
          '功能使用咨询',
          '业务规则咨询',
          '是否支持',
          '专线配置不收费',
          '承载网',
          '端口',
          '1G',
          '10G',
          '规格',
          '演示',
          '产品咨询',
          '接入问题',
          '主备交换机',
          'vlan',
          '分配接口',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '订购与权限',
    description: '云端口订购、灰度权限、特邀用户审批、省代表流程、可用区选择',
    children: [
      {
        id: 'provision-permission',
        label: '灰度与订购权限',
        description: '特邀用户限制、灰度码配置、省代表审批、产品侧同意、客户经理联系代表处',
        keywords: [
          '订购权限',
          '开通权限',
          '灰度',
          '灰度码',
          '特邀用户',
          '仅针对特邀',
          '省代表',
          '产品侧同意',
          '客户经理',
          '代表处',
          '证明',
          '必要性',
          '开通订购权限',
          '无法订购',
          '主账号',
          '子账号',
          '没有订购权限',
        ],
      },
      {
        id: 'provision-onboard',
        label: '产品上架与交付',
        description: '云端口上架、安装交付、配置专线开通流程',
        keywords: [
          '上架',
          '安装交付',
          '交付',
          '专线开通',
          '配置',
          '提供信息',
          '提交专线开通流程',
        ],
      },
    ],
  },
  {
    id: 'configure',
    label: '承载网与路由配置',
    description: '承载网连通配置、VLAN/IP分配、路由策略、对端交换机配置',
    children: [
      {
        id: 'configure-network',
        label: '承载网与VLAN配置',
        description: '打通到承载网、VLAN31/32创建、IP配置、对端交换机策略、路由配置',
        keywords: [
          '承载网',
          'VLAN',
          'vlan31',
          'vlan32',
          '配置ip',
          '交换机',
          '主备交换机',
          '分配接口',
          '对端交换机',
          '策略',
          '路由',
          '路由策略',
          '打通到承载网',
          '网络',
          'IP配置',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '运行与质量',
    description: '已开通后的报障：承载网不通、网络卡顿、硬盘延迟、数据传输异常',
    children: [
      {
        id: 'operate-connect',
        label: '连通性异常',
        description: '承载网不通、到承载网地址不通、对端交换机不通、网络无法连通',
        keywords: [
          '不通',
          '无法访问',
          '承载网',
          '地址不通',
          '不通了',
          '发现到',
          '对端交换机',
          '策略是否正常',
          '这是什么设备',
          '无法连通',
        ],
      },
      {
        id: 'operate-quality',
        label: '性能与卡顿',
        description: '网络卡顿、数据上传卡、硬盘延迟高、五秒以上延迟、上下行不对等',
        keywords: [
          '卡顿',
          '卡',
          '慢',
          '延迟',
          '延迟高',
          '硬盘延迟',
          '800',
          'ms',
          '数据上传',
          '上传数据',
          '非常卡',
          '五秒',
          '延迟差',
          '软件操作',
          '云专线利用率',
          '参数未达瓶颈',
        ],
      },
    ],
  },
  {
    id: 'change',
    label: '子网变更与搬迁',
    description: '子网变更、搬迁、云电脑网络接入、承载网迁移',
    children: [
      {
        id: 'change-subnet',
        label: '子网变更与搬迁',
        description: '子网变更、网络搬迁、云电脑内网接入、承载网迁移',
        keywords: [
          '子网变更',
          '搬迁',
          '云电脑',
          '网络内网接入',
          '常州',
          '苏州可用区4',
          '承载网迁移',
          '变更',
          '搬迁网络',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与释放',
    description: '退订云端口、退订失败、退订界面异常',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与释放',
        description: '退订云端口、退订界面异常报错、退订失败、退订所有服务',
        keywords: [
          '退订',
          '取消',
          '释放',
          '退订界面异常',
          '退订失败',
          '无法退订',
          '订单无法退订',
          '退订所有服务',
          '退订云端口',
          '退订/取消',
        ],
      },
    ],
  },
  {
    id: 'service',
    label: '服务与流程',
    description: '工单进度催办、审批流程跟进（非技术排障入口）',
    children: [
      {
        id: 'service-progress',
        label: '工单进度与催办',
        description: '催办审批进度、加急处理、省代表跟进',
        keywords: [
          '催',
          '进度',
          '审批',
          '加急',
          '跟进',
          '协助联系代表处',
          '后台已协助联系',
          '烦请',
        ],
      },
    ],
  },
]

export const CLOUD_PORT_PRODUCT_MATCH = [
  '云端口',
  'cloud_port',
  'CloudPort',
  '云端口产品',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const CLOUD_PORT_NODE_SERVICE_MAP = {
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
export const CLOUD_PORT_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  '云端口功能使用咨询': { l1: 'discover', l2: 'discover-capability' },
  '云端口业务规则咨询': { l1: 'discover', l2: 'discover-capability' },
  '云端口退订/取消': { l1: 'release', l2: 'release-unsubscribe' },
  '订单-因退订界面异常报错而退订失败': { l1: 'release', l2: 'release-unsubscribe' },
  其他: { l1: 'operate', l2: 'operate-connect' },
}

export const CLOUD_PORT_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const CLOUD_PORT_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性': '可用性/连通性故障',
}
