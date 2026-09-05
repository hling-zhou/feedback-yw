/**
 * 融合 VPN 用户旅程 — 基于实单 TOP 场景收束
 *
 * 校准依据：本系统 44 条 productKey=vpn 工单（2026-04～05 投诉/咨询）
 * 高频：IPSec 隧道连通/中断、SSL VPN 客户端安装与断线、订购开通、隧道/子网配置、灰度权限。
 *
 * @typedef {{ id: string; label: string; description: string; keywords: string[] }} JourneyL2
 * @typedef {{ id: string; label: string; description: string; children: JourneyL2[] }} JourneyL1
 */

/** @type {JourneyL1[]} */
export const VPN_USER_JOURNEY = [
  {
    id: 'discover',
    label: '认知与方案',
    description:
      '了解 IPSec/SSL VPN 能力、订购规格、境外使用与多云对接方案（报障类请结合请求场景=报障与排错）',
    children: [
      {
        id: 'discover-capability',
        label: '产品与能力咨询',
        description: 'IPSec/SSL 差异、IPv6、境外使用、双隧道、与华为/阿里云对接、政务外网/量子方案',
        keywords: [
          '融合vpn功能',
          '融合VPN功能',
          '融合VPN实例',
          '是否有SSL VPN功能',
          'IPv6',
          'IPv4',
          '马来西亚',
          '只支持国内',
          '双隧道',
          '阿里云的IPSec VPN',
          '华为的VPN',
          '量子密钥',
          '政务外网',
          'Smart VPN',
          '不能用于上国外网站',
          '业务规则咨询',
        ],
      },
      {
        id: 'discover-billing',
        label: '资费与订购规格咨询',
        description: '购买指导、价格总览、并发数规格、证书编号',
        keywords: [
          '购买指导',
          '价格总览',
          '并发数',
          '订购页面最小',
          '证书编号',
          'VPN订购',
          '意向购买',
          '商机需求',
        ],
      },
    ],
  },
  {
    id: 'provision',
    label: '开通与订购',
    description: 'VPN 实例订购开通、续订、并发规格、灰度与可用区/资源池订购权限',
    children: [
      {
        id: 'provision-order',
        label: '实例订购与开通',
        description: '订购 VPN、续订、开通、资源池/可用区选择、换资源池迁移',
        keywords: [
          '怎么订购VPN',
          '怎么订购',
          '订购VPN',
          '订购ssl vpn',
          '续订',
          'IP sec续订',
          '要求开通',
          '还有200多天',
          '换个资源池下单',
          '资源都要迁移',
          '选择不了可用区',
        ],
      },
      {
        id: 'provision-quota',
        label: '配额与规格申请',
        description: '并发数 50 等特殊规格、订购页面规格下限',
        keywords: [
          '并发数是50',
          '最小是100',
          '规格申请',
          '流量包',
        ],
      },
      {
        id: 'provision-permission',
        label: '灰度与订购权限',
        description: 'SSL VPN 双因子灰度、可用区订购权限、资源池临时下架替代',
        keywords: [
          '双因子认证',
          '灰度权限',
          '申请开通SSL VPN',
          '申请权限',
          '临时下架',
          '就近的资源池',
          '提单申请权限',
        ],
      },
    ],
  },
  {
    id: 'configure',
    label: '隧道与接入配置',
    description: 'IPSec 隧道、SSL VPN 服务、子网与路由规划配置',
    children: [
      {
        id: 'configure-ipsec',
        label: 'IPSec 隧道配置',
        description: '用户网关、对端子网、隧道参数、与第三方 VPN 对接',
        keywords: [
          'IPSec VPN如何与华为',
          '用户网关',
          '对端子网',
          '隧道参数',
          '同时和',
          '做隧道',
          'IPsec VPN能否使用到云电脑',
          '虚拟网卡',
        ],
      },
      {
        id: 'configure-ssl',
        label: 'SSL VPN 服务配置',
        description: '服务端子网修改、公网 IP 绑定、远程网关地址端口、内部 DNS',
        keywords: [
          'sslvpn服务端',
          '占用子网',
          '绑定到sslvpn',
          '远程网关地址',
          '内部dns',
          'SSL VPN如何配置',
          'ip无续费',
          '无法编辑',
        ],
      },
      {
        id: 'configure-network',
        label: '网络与子网规划',
        description: '对端子网/用户子网填写、VPC 子网与专线关系、路由',
        keywords: [
          '对端子网网络地址',
          '用户子网',
          '都不能相同',
          '本地的公网和内网',
          'VPC子网',
          '子网无法使用',
          '怎么填写',
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: '运行与故障排障',
    description: 'IPSec/SSL 连通异常、客户端安装失败、断线与业务访问问题',
    children: [
      {
        id: 'operate-ipsec',
        label: 'IPSec 连通异常',
        description: '隧道不通、偶发中断、续订后不通、数据有去无回、VPN 起不来',
        keywords: [
          'ipsec 经常出现无法通信',
          '偶发性中断',
          'IP sec续订后目前还不通',
          'ipsec不通',
          '显示未连接',
          '数据有去无回',
          'VPN 起不来',
          'VPN连接编码',
          'IPSec-vpn断开',
          '怀疑是ipsecvpn',
          '清明假期后发现',
        ],
      },
      {
        id: 'operate-ssl',
        label: 'SSL VPN 连接异常',
        description: '无法连接、频繁断线、登录后无法访问业务系统、没有走数据',
        keywords: [
          'VPN无法连接',
          'ssl vpn链接频繁断线',
          'SSL VPN登录不上',
          '登录上之后访问',
          '访问不了',
          'VPN没有走数据',
          'vpn提示错误',
        ],
      },
      {
        id: 'operate-client',
        label: '客户端安装与使用',
        description: '客户端装不上、版本冲突、Smart VPN/Ecloud Client 安装下载失败',
        keywords: [
          '安装客户端失败',
          'Ecloud VPN Client 已经安装',
          'Smart VPN无法安装',
          '无法安装下载',
          'VPN客户端装不上',
          'windows server 2008',
          '客户端下载',
          'VPN在哪里下载',
          '客户端下载地址',
          '卸载',
        ],
      },
    ],
  },
  {
    id: 'release',
    label: '退订与释放',
    description: '退订、取消融合 VPN 实例',
    children: [
      {
        id: 'release-unsubscribe',
        label: '退订与撤销',
        description: '退订/取消融合 VPN',
        keywords: [
          '退订',
          '取消',
          '被退订',
        ],
      },
    ],
  },
  {
    id: 'service',
    label: '服务与流程',
    description: '拉群催办、代客建单、操作指导与文档；有连通问题时优先走运行环节',
    children: [
      {
        id: 'service-progress',
        label: '工单进度与催办',
        description: '拉群催办、代客建单、临时下架跟进；不是技术排障入口',
        keywords: [
          '拉群',
          '建群',
          '代客建单',
          '代客提单',
          '烦请协助处理',
          '连接客服解决',
        ],
      },
      {
        id: 'service-guide',
        label: '文档与操作指导',
        description: '客户端下载、订购路径、操作步骤、帮助文档',
        keywords: [
          'op-help-center',
          '帮助中心',
          '已发送链接',
          '操作流程',
          '告知订购路径',
          '已发送客户端下载链接',
        ],
      },
    ],
  },
]

export const VPN_PRODUCT_MATCH = [
  '融合VPN',
  'VPN',
  'vpn',
  'IPSec',
  'IPsec',
  'SSL VPN',
  'Smart VPN',
]

/** 请求节点服务类型 → 旅程一级默认映射 */
export const VPN_NODE_SERVICE_MAP = {
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
export const VPN_NODE_ISSUE_MAP = {
  产品咨询: { l1: 'discover', l2: 'discover-capability' },
  产品功能: { l1: 'discover', l2: 'discover-capability' },
  'IPSecVPN产品使用(咨询)': { l1: 'configure', l2: 'configure-ipsec' },
  '可用性/连通性': { l1: 'operate', l2: 'operate-ipsec' },
  其他: { l1: 'configure', l2: 'configure-ipsec' },
}

export const VPN_REQUEST_SCENE_PATH_MAP = {
  产品使用问题: '产品信息咨询',
  故障报修: '报障与排错',
  报障: '报障与排错',
}

export const VPN_PROBLEM_TYPE_PATH_MAP = {
  '可用性/连通性故障': '可用性/连通性故障',
  配额与权限申请: '配额与权限申请',
  资源开通与创建: '资源开通与创建',
}
