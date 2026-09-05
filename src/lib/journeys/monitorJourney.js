/**
 * 云监控（Monitor）用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：本系统 64 条 productKey=monitor 工单（2026-04～05 投诉/咨询）
 * 业务约束：注册移动云账号即可使用，无独立开通订购与资费咨询环节；
 * 运行观测与故障报障合并为 operate；服务环节只留催办与文档，不承接协查/排查。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const MONITOR_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description:
      '了解云监控能力、拨测规则、指标差异与产品边界（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '产品与能力咨询',
        description: '拨测能力、资源池含义、对外拨测 IP、Agent 与虚拟化指标差异、是否支持某特性',
        keywords: [
          '功能使用咨询',
          '业务规则咨询',
          '是否具备这个功能',
          '是否支持',
          'tcp拨测功能使用咨询',
          '资源池是',
          '资源池是指',
          '有什么区别',
          '差异原因',
          'CPU利用率（Agent）',
          '不带agent',
          '虚拟化接口',
          '进程相关的监控面板',
          '云监控功能',
          'CES',
          '关机或者意外宕机',
          '没地方开通',
          '云产品监控',
          '客户咨询云监控',
        ],
      },
    ],
  },
  {
    id: 'access',
    label: '接入与使用准备',
    description:
      '注册账号即可使用；涵盖配额权限、拨测白名单、Agent/QGA 安装升级等使用前置事项',
    children: [
      {
        id: 'access-quota',
        label: '配额与权限申请',
        description: '转储任务配额、告警/图表数量上限',
        keywords: [
          '转储任务',
          '转储任务产品数量配额',
          '配额申请',
          '提升配额',
          '图表数量配额',
          '批量添加200个',
          '申请至50个',
          '提高到50',
        ],
      },
      {
        id: 'access-permission',
        label: '灰度与订购权限',
        description: 'Kafka 转储灰度、DDH 监控模块、RAM / API 权限申请',
        keywords: [
          'kafka灰度',
          '转存到kafka',
          '灰度',
          'DDH的CPU',
          'DDH集群',
          '宿主机）模块',
          'ram账号添加权限',
          'API接口权限',
          '订购权限',
          '开通权限',
        ],
      },
      {
        id: 'access-whitelist',
        label: '白名单与拨测接入',
        description: '内网拨测白名单、HTTP(S) 拨测出口 IP、出网 IP 白名单、源地址范围',
        keywords: [
          '内网拨测白名单',
          '拨测白名单',
          '对外拨测的IP',
          '出网 IP 白名单',
          '出网IP白名单',
          '源地址范围',
          '拨测平台的IP',
          '加了白名单',
          'IP白名单限制',
          '添加一下白名单',
        ],
      },
      {
        id: 'access-agent',
        label: 'Agent/QGA 安装与升级',
        description: 'qemu-ga/QGA 安装、批量升级、openEuler 等系统支持、安装交付通知接入',
        keywords: [
          'qemu-ga',
          'QGA',
          'qga版本',
          '批量升级',
          'openEuler',
          'Agent安装',
          '安装交付',
          '安装与异常处理',
          '升级链接',
          '采集组件',
        ],
      },
    ],
  },
  {
    id: 'configure',
    label: '监控与告警配置',
    description: '告警规则、通知渠道、监控大盘、拨测任务、指标与数据导出配置',
    children: [
      {
        id: 'configure-alarm',
        label: '告警规则配置',
        description: '告警规则/策略、阈值、CPU 利用率告警、告警任务创建与状态',
        keywords: [
          '告警规则',
          '告警策略',
          '阈值告警',
          'cpu使用率',
          '配置告警',
          '告警任务',
          '拨测告警的任务',
          '修改为CPU利用率',
          '分配率的告警策略',
        ],
      },
      {
        id: 'configure-notify',
        label: '通知渠道配置',
        description: '短信、邮件、通知模板、告警触发通知内容',
        keywords: [
          '短信',
          '邮件通知',
          '告警触发',
          '短信和邮件',
          '收到公网',
          '触发告警，详情见',
        ],
      },
      {
        id: 'configure-dashboard',
        label: '监控大盘与视图',
        description: '仪表盘、面板数量/每台主机数限制、批量监控多台主机方案',
        keywords: [
          '监控面板',
          '监控大盘',
          '仪表盘',
          '十个监控面板',
          '十台云主机',
          '200台云主机',
          '监控200台',
        ],
      },
      {
        id: 'configure-dialtest',
        label: '拨测任务配置',
        description: 'TCP/HTTP 拨测任务创建、资源池选择、任务状态不刷新',
        keywords: [
          '拨测任务',
          'tcp拨测',
          'http拨测',
          'https拨测',
          '公网拨测',
          '状态不刷新',
          '暂无状态',
          '苏州资源池',
          '可用区11',
        ],
      },
      {
        id: 'configure-metric',
        label: '指标与数据管理',
        description: '指标配置、数据导出/转储、历史数据保留、AK/SK 拉取监控数据',
        keywords: [
          '数据导出',
          '导出云监控',
          '导出近半年',
          '导出1.1-4.30',
          '下载云主机',
          '使用日志',
          'ak sk',
          '拉取监控',
          '转储',
          '转存',
          '历史数据',
          '6个月',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '运行与故障排障',
    description: '现网监控数据异常、采集上报故障、关联资源监控视图异常、告警不生效或误报',
    children: [
      {
        id: 'operate-data',
        label: '监控数据异常',
        description: '指标与实际不符、带宽/网络监控异常、实时显示不正常、性能劣化、导出缺项',
        keywords: [
          '监控数据不准确',
          '缺失数据',
          '数据不准确',
          '统计不对',
          '显示不正常',
          '没有监控数据',
          '指标未正常采集',
          '多项参数为空',
          '导出来的数据有几项',
          '指标都没有显示',
          'nat网关带宽监控',
          '带宽监控查看不了',
          '实时监控显示不正常',
          '入网带宽和入网流量',
          '性能监控指标',
          '云监控异常',
        ],
      },
      {
        id: 'operate-agent',
        label: '采集组件与上报',
        description: 'QGA 版本过低、采集上报异常、Agent 与虚拟化采集差异导致的数据问题',
        keywords: [
          '采集上报异常',
          'qga旧版',
          'qga版本过低',
          '上报异常',
          '进程监控服务',
          '数据采集设备',
        ],
      },
      {
        id: 'operate-resource',
        label: '关联资源监控',
        description: '云主机/ECS、负载均衡、NAT、带宽包、共享带宽等关联产品监控视图异常',
        keywords: [
          '负载均衡监控',
          'ecs主机的网络监控',
          'ecs主机',
          '云主机网络监控',
          '带宽包的使用',
          '共享带宽',
          '没有监控数据',
          '查看主机的监控',
        ],
      },
      {
        id: 'operate-alarm',
        label: '告警异常',
        description: '告警不生效、误报/漏报、拨测告警暂无状态、未收到应有告警',
        keywords: [
          '告警不准确',
          '告警缺失',
          '没有发送监控告警',
          '异常告警',
          '告警是怎么产生的',
          '停止报数时接收报警',
          '未收到',
          '误报',
        ],
      },
    ],
  },
  {
    id: 'service',
    label: '服务与流程',
    description: '催办进度、文档与操作指导；监控数据/告警异常优先走运行环节',
    children: [
      {
        id: 'service-progress',
        label: '工单进度与催办',
        description: '催办、需求单跟进、重复回复投诉；不是协查或排障入口',
        keywords: [
          '催',
          '进度',
          '需求单',
          '不关闭本工单',
          '拉群处理',
          '投诉工单',
          '复读机',
          '协助处理',
        ],
      },
      {
        id: 'service-guide',
        label: '文档与操作指导',
        description: '帮助文档、操作步骤、升级链接、API 文档指引',
        keywords: [
          '帮助文档',
          '帮助中心',
          '操作步骤',
          '怎么下载',
          '如何配置',
          '提供文档',
          'api接口文档',
          '接口文档',
          '引导到云监控页面',
        ],
      },
    ],
  },
]

export const MONITOR_PRODUCT_MATCH = ['云监控', '监控', 'monitor', '拨测', '告警', 'CES']

/** 请求节点服务类型 → 旅程一级默认映射 */
export const MONITOR_NODE_SERVICE_MAP = {
  产品咨询: 'discover',
  产品功能: 'discover',
  产品使用问题: 'configure',
  产品使用: 'configure',
  业务方案支撑: 'discover',
  资源申请与开通: 'access',
  报障与恢复: 'operate',
  故障报修: 'operate',
  报障: 'operate',
  进度查询与协同: 'service',
  其他: 'service',
}

/** 请求节点问题子类 → 旅程二级提示 */
export const MONITOR_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  监控数据不准确: { l1: 'operate', l2: 'operate-data' },
  告警不准确: { l1: 'operate', l2: 'operate-alarm' },
  告警缺失: { l1: 'operate', l2: 'operate-alarm' },
  其他: { l1: 'configure', l2: 'configure-alarm' },
}

export const MONITOR_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const MONITOR_PROBLEM_TYPE_PATH_MAP = {
  配额与权限申请: '配额与权限申请',
  性能问题: '性能问题',
  人工服务与流程: '人工服务与流程',
}
