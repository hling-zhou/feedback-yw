/**
 * NAT 网关用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：本系统 69 条 productKey=nat 工单（2026-04～05 投诉/咨询）
 * 高频：配额/灰度/订购权限/上架、SNAT/DNAT 规则配置、开通创建、退订删除、规则不生效与连通性。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const NAT_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与选型',
    description:
      '了解 NAT 网关 SNAT/DNAT 能力、与 EIP/VPC/共享带宽关系、计费模式（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '产品与能力咨询',
        description: 'SNAT/DNAT 能力、网络拓扑、多 VPC/多公网 IP 规则、ICMP 代回、可用区关系',
        keywords: [
          '功能使用咨询',
          '业务规则咨询',
          '是否可以',
          '能不能',
          '一个NAT网关是否可以',
          '一个公网IP是否可以',
          'ICMP代回',
          '网络拓扑',
          '性能保障型',
          '负载均衡做调度',
          '两台云主机只有一个公网ip',
          'NAT找不到了',
          '能否订购到可用区',
          '同一个VPC',
        ],
      },
      {
        id: 'discover-billing',
        label: '资费与计费咨询',
        description: '包年包月/按量、CU 计费型、超限折扣资费编码、账单折扣',
        keywords: [
          '包年',
          '包月',
          '按量计费',
          'CU计费',
          'CU计费型',
          '超限折扣',
          '资费编码',
          '折扣未生效',
          '计费规则',
          '如何计费',
          '资费',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '开通与订购',
    description: 'NAT 网关实例创建订购、配额限制、灰度与可用区订购权限、规格上架',
    children: [
      {
        id: 'provision-create',
        label: '实例创建与订购',
        description: '创建/订购 NAT 网关、创建失败、无法订购、安装交付、无资源',
        keywords: [
          '创建失败',
          '无法订购',
          'NAT网关无法订购',
          '订购/开通',
          '安装交付',
          '页面无法订购',
          '提示无资源',
          '无法续订',
        ],
      },
      {
        id: 'provision-quota',
        label: '配额与实例数',
        description: 'VPC NAT 个数配额超限、配额已满、扩容、DNAT 规则配额提升',
        keywords: [
          '配额已满',
          '配额超限',
          'NAT网关个数',
          '剩余可订购量',
          '提升配额',
          '申请扩容',
          '额外新增一个配额',
          '触发限制',
          'dnat规则配额',
          '提升数量',
        ],
      },
      {
        id: 'provision-permission',
        label: '灰度与订购权限',
        description: '灰度码开通、可用区订购权限、规格上架、SNAT 多绑 EIP 权限',
        keywords: [
          '灰度',
          '灰度码',
          '灰度权限',
          'NAT_IP_MSUBNET',
          'NEXTHOP_NAT',
          'NAT_Random_Port',
          'IP_NAT_JOIN_SHARED_BANDWIDTH',
          '订购权限',
          '烦请上架',
          '临时上架',
          '上架nat网关',
          '开通多个SNAT绑定同一个EIP',
          '加下灰度',
        ],
      },
    ],
  },
  {
    id: 'configure',
    label: '规则与绑定配置',
    description: 'SNAT/DNAT 规则、公网 IP/EIP 绑定、子网与路由关联',
    children: [
      {
        id: 'configure-snat',
        label: 'SNAT 规则配置',
        description: 'SNAT 规则创建、绑定公网 IP/EIP、共享带宽 IP 绑定 SNAT',
        keywords: [
          'SNAT规则',
          '配置snat',
          '创建SNAT',
          '绑定公网IP',
          '绑定到snat规则',
          '共享带宽的ip',
          '共享带宽IP',
          '闲置IP',
          'snat规则粒度',
          '两个公网IP做SNAT',
        ],
      },
      {
        id: 'configure-dnat',
        label: 'DNAT 规则配置',
        description: 'DNAT 端口映射、规则增删改、选择子网/未绑定 IP、安全组端口',
        keywords: [
          'DNAT规则',
          '创建DNAT',
          '端口映射',
          '怎么做DNAT',
          '选择不到未绑定IP',
          '未绑定IP',
          '只能发现',
          'subnet',
          '掩盖主机端口',
          '安全组是放行',
          '映射到外网',
        ],
      },
      {
        id: 'configure-network',
        label: '子网与路由关联',
        description: '子网关联、路由下一跳、VPC 内 NAT 绑定、可用区选择',
        keywords: [
          '子网',
          '路由',
          '下一跳',
          '出网路径',
          '绑定NAT',
          '可用区1',
          '可用区4',
          '中心可用区',
          '内网ip',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '运行与故障排障',
    description: 'SNAT/DNAT 不生效、端口不通、出网异常、NAT 转发性能与限速',
    children: [
      {
        id: 'operate-snat',
        label: 'SNAT 访问异常',
        description: 'SNAT 不生效、无法绑定 IP、出网访问失败、无法通外网',
        keywords: [
          'SNAT功能问题',
          'SNAT无法绑定IP',
          'snat出口',
          '无法通外网',
          '无法访问通',
          'SNAT规则',
          '无法当做snat公网ip',
          'nat监控看不到了',
          '网络阻塞',
        ],
      },
      {
        id: 'operate-dnat',
        label: 'DNAT 访问异常',
        description: 'DNAT 规则不生效、端口不通/超时、部分映射异常、无法 SSH',
        keywords: [
          'DNAT功能问题',
          'DNAT规则管理异常',
          '不生效',
          '端口还是不通',
          'telnet都不通',
          '访问不了',
          '返回超时',
          '突然不通',
          '无法ssh',
          '做的NAT端口也不通',
          '其它的DNAT映射都正常',
        ],
      },
      {
        id: 'operate-quality',
        label: '性能与限速',
        description: 'NAT 转发限速、延迟高、异网访问质量、晚高峰传输慢',
        keywords: [
          'NAT转发',
          '做了什么限速',
          '网络延迟',
          '数据传输慢',
          '晚高峰',
          '异网',
          '电信联通',
          '移动宽带可以连接',
          '部分网络能访问',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与释放',
    description: '退订 NAT 网关、删除失败、DNAT 规则删除异常',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与撤销',
        description: '退订/取消 NAT 网关、订单被退订、恢复资源',
        keywords: [
          '退订/取消',
          '被退订',
          '恢复资源',
          'MOP-T-',
          '预警短信',
          '显示为空',
          '没有任何实例',
        ],
      },
      {
        id: 'release-delete',
        label: '删除与规则清理',
        description: 'NAT 删除失败、DNAT 规则长时间删除中/删除失败',
        keywords: [
          '删除失败',
          'DNAT规则删除',
          '长时间删除中',
          '删除中等待后失败',
        ],
      },
    ],
  },
  {
    id: 'service',
    label: '服务与流程',
    description: '审批催办、拆单跟进、操作指导与文档；有连通/规则问题时优先走运行环节',
    children: [
      {
        id: 'service-progress',
        label: '工单进度与催办',
        description: '催办审批、拆单跟进；不是技术排障入口',
        keywords: [
          '拆单跟进',
          '拆单处理',
          '烦请协助处理',
          '协助处理',
          '专人对接',
          '接上一单',
        ],
      },
      {
        id: 'service-guide',
        label: '文档与操作指导',
        description: '操作步骤、如何配置/订购、帮助文档、API 订购参数',
        keywords: [
          '如何配置',
          '如何订购',
          '操作流程',
          '帮助中心',
          'op-help-center',
          '提供指引',
          '已发送操作',
          'API接口',
          '子网id',
          '用户心声',
        ],
      },
    ],
  },
]

export const NAT_PRODUCT_MATCH = ['NAT网关', 'NAT', 'nat', 'SNAT', 'DNAT', 'nat网关']

/** 请求节点服务类型 → 旅程一级默认映射 */
export const NAT_NODE_SERVICE_MAP = {
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
export const NAT_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  SNAT功能问题: { l1: 'operate', l2: 'operate-snat' },
  DNAT功能问题: { l1: 'operate', l2: 'operate-dnat' },
  DNAT规则管理异常: { l1: 'operate', l2: 'operate-dnat' },
  创建失败: { l1: 'provision', l2: 'provision-create' },
  删除失败: { l1: 'release', l2: 'release-delete' },
  其他: { l1: 'configure', l2: 'configure-snat' },
}

export const NAT_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const NAT_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性故障': '可用性/连通性故障',
  配额与权限申请: '配额与权限申请',
  资源开通与创建: '资源开通与创建',
  退订与释放: '退订与释放',
}
