/* =========================================================================
 * 行动建议引擎核心（actionRecsEngine.cjs）
 * -------------------------------------------------------------------------
 * 从 validate-action-recs.cjs 抽取的纯函数模块——不读文件、不写文件、不 spawn 子进程。
 * 在线（快照重建时）和离线（CLI 人工触发）共用同一套逻辑。
 *
 * 暴露：
 *   runEngine(records, opts)     → 引擎核心：跑分类产出结果（不自判）
 *   runGate(engineResult, opts) → 门禁：独立重算 + 检查（从内存结果读）
 *   runFixer(gateReport, engineResult, taxMap) → 修复：外科式收紧 overrides（内存对象）
 *   runLoop(records, opts)      → 有界闭环：runEngine → runGate → (FAIL → runFixer → 重跑) → 最多 N 轮
 *
 * 三方分离原则不变：
 *   · runEngine 不做判定（只跑分类产出结果）
 *   · runGate 不跑分类（只独立校验 runEngine 的结果）
 *   · runFixer 不跑分类不改基线（只读 runGate 的失败项 + 证据，产出 overrides 增量）
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

// =========================================================================
// 辅助函数（从 validate-action-recs.cjs L21-88 原样移出）
// =========================================================================

// 字段名别名：引擎内部用中文字段名（从 xlsx CLI 路径），
// 但在线快照传入的 FeedbackRecord 用驼峰。get() 先试原始字段名，回退到别名。
const FIELD_ALIASES = {
  '产品名称': ['product', 'productName'],
  '问题原因': ['rootCause', 'rootCauseCol'],
  '需求痛点': ['painPoint', 'problemSummary'],
  '工单号': ['ticketId'],
  '客户请求内容': ['customerRequest'],
  '受理内容': ['rawText'],
  '处理意见': ['handlingText'],
  '产品技术优化': ['optimizationProduct'],
  '是否加急': ['urgencyLevel'],
  '_src': ['source', 'dataSourceType'],
  '_month': ['importMonth'],
  '_sheet': ['importSheetName'],
};

function get(r, f) {
  let v = String(r[f] || '').trim();
  if (v) return v;
  const aliases = FIELD_ALIASES[f];
  if (aliases) {
    for (const a of aliases) {
      v = String(r[a] || '').trim();
      if (v) return v;
    }
  }
  return '';
}

// source 字段值适配：DB records 的 source 是 'complaint_ticket'/'consultation_ticket'，
// 引擎内部逻辑用 '投诉'/'咨询'。srcOf 统一转换。
function srcOf(r) {
  const raw = get(r, '_src');
  if (raw === '投诉' || raw === '咨询') return raw;
  if (raw === 'complaint_ticket') return '投诉';
  if (raw === 'consultation_ticket') return '咨询';
  return raw;
}

function monthOf(r) {
  const pre = get(r, '_month');
  if (pre) return pre;
  const s = get(r, '_sheet');
  const m = s.match(/(\d{4})年(\d{1,2})月/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : '?';
}

function firstSentence(s) {
  const i = s.search(/[。！\n]/);
  return (i < 0 ? s : s.slice(0, i)).slice(0, 80).trim();
}

const FLOW_NOISE = /客户标签[：:][^，。；]*|请求节点[：:][^，。；]*|工单标题[：:][^，。；]*|产品名称[：:][^，。；]*|受理渠道[：:][^，。；]*|联系时间[：:]?[0-9：: \-—]*|客服组[.．][^，。；]*|协办[^，。；]*|请[^，。；]{0,15}组|开始&[^&]*&|首处理&[^&]*&|详细内容[：:]|处理意见[：:]|^\s*[0-9]+[、．.][^，。；]*|预处理[：:][^，。；]*|产品UUID[：:][^，。；]*|协助请求[：:][^，。；]*/g;

function cleanFlowNoise(s) {
  if (!s) return '';
  return String(s).replace(FLOW_NOISE, ' ').replace(/\s{2,}/g, ' ').replace(/[##]+/g, ' ').trim();
}

function voiceOf(r) {
  const parts = [];
  const seen = new Set();
  for (const f of ['客户请求内容', '受理内容', '处理意见']) {
    let v = get(r, f);
    if (f !== '客户请求内容') v = cleanFlowNoise(v);
    v = firstSentence(v);
    if (v.length < 5) continue;
    const key = v.slice(0, 20);
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(v);
  }
  if (!parts.length) return null;
  return { f: parts.length > 1 ? '客户请求内容+受理/处理意见' : (get(r,'客户请求内容').length>=8?'客户请求内容':'受理内容/处理意见'), v: parts.join('；') };
}

const DISPOSAL_CUE = /已(?:通知|为您|协助|处理|解绑|添加|开通|变更|恢复|解除|配置|升级|告知|建议|同步|跟进|核实|确认|关闭|完成|引导|协助客户|联系)[^，。；]*|省代表(?:通知|建议|联系)[^，。；]*|建议(?:客户|先)[^，。；]*|请(?:客户|先|联系|确认)[^，。；]*|已(?:退订|订购|创建|升级|变更|完成)[^，。；]*/g;

function cleanReason(s) {
  if (!s) return '';
  let cleaned = String(s).replace(DISPOSAL_CUE, ' ').replace(/\s{2,}/g, ' ').trim();
  if (cleaned.length < 5) cleaned = String(s).trim();
  return cleaned;
}

const BOILER_REASON = /工单未定位到具体问题原因|未定位到具体.*原因|未明确.*具体情况|原因未明确|未明确具体问题|未定位具体问题/;

function isBoilerplateReason(r) {
  return BOILER_REASON.test(get(r, '问题原因'));
}

function topSentence(rows, field) {
  const k = topK(rows, field, 1);
  return k.length ? k[0].s : '';
}

function topK(rows, field, k) {
  const c = {};
  for (const r of rows) {
    const v = firstSentence(get(r, field));
    if (!v || v.length < 4) continue;
    c[v] = (c[v] || 0) + 1;
  }
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, k).map(([s, n]) => ({ s, c: n }));
}

// =========================================================================
// 分类法基线（从 validate-action-recs.cjs L90-619 原样移出）
// =========================================================================

const TAX = {
  云专线: {
    families: [
      { key: 'conn', name: '连通性与网络质量', re: /断连|断网|网络连|链路|丢包|时延|延迟|网络质量|带宽未达|带宽不足|网络性能|连通|互访|中断|卡顿|抖动|ping|trace|mtr|专线.*不通|无法访问.*专线|专线.*故障|对端不|两端无法|网络波动|网络不稳|时有时无|网络中断/,
        subs: [
          { key: 'interrupt', name: '专线中断/断连', re: /中断|断连|断网|专线.*不通|链路中断|连接中断|频繁断|网络中断|网络波动|时有时无/ },
          { key: 'loss', name: '丢包', re: /丢包|丢包率|重传|70%.*丢包/ },
          { key: 'latency', name: '时延/延迟', re: /时延|延迟|卡顿|语音.*受影响/ },
          { key: 'bw', name: '带宽未达预期', re: /带宽未达|带宽不足|带宽.*预期|网络性能未达|带宽.*跑满/ },
        ] },
      { key: 'billing', name: '计费与折扣', re: /计费|折扣|包年转|转包月|账单|费用|收费|价格|超限折扣/,
        subs: [
          { key: 'convert', name: '包年转包月', re: /包年转|转包月|计费模式|转换|订购时间.*早于/ },
          { key: 'discount', name: '折扣未生效', re: /折扣|未生效|超限折扣|计费规则|账单中/ },
        ] },
      { key: 'config', name: '配置与接入限制', re: /虚拟网关|VPC.*关联|对等连接|路由优先级|路由配置|网关|关联.*VPC|子网后网络不通|BGP|光模块|对接端|加密|容灾|跨境|国外线路|国际|节点地域|地域|接入节点|配置要求|操作指引|网络打通|互联|带宽升级|边缘云|接入网络类型|开通需求|接入类型/,
        subs: [
          { key: 'vpc', name: 'VPC关联限制', re: /仅支持.*VPC|关联.*VPC|虚拟网关|对等连接|网段转发|接入类型|网络打通|互联/ },
          { key: 'route', name: '路由/BGP配置', re: /路由优先级|路由配置|路由.*转发|BGP|本端.*云端路由/ },
          { key: 'cap', name: '产品能力/覆盖/文档', re: /能力说明|官方信息|文档|加密|容灾|光模块|对接端|国际|国外线路|跨境|带宽升级.*可行|边缘云|节点地域|地域|接入节点/ },
        ] },
      { key: 'order_flow', name: '订购与变更流程', re: /续订|订购|变更|开通|带宽变更|资费|订单进度|订单状态|自动续订|到期冻结|名称.*修改|移机|自动注销|创建.*失败|创建时遭遇|未直观|入口位置|操作路径|续订.*操作|客户经理|渠道|欠费|加急.*开通|预开通|建群|转派|服务区域|注册中|商机|审批|意向|开通时限|协调|流程.*不透明|流程.*指引|缺乏.*指引|无法.*选择.*区域|对端未审批/,
        subs: [
          { key: 'open', name: '开通/订购渠道与指引', re: /订购|开通|意向|客户经理|渠道|跨境|节点|地域|服务区域|注册中|商机|审批|对端未审批|开通时限|资费|订单进度|流程.*不透明|流程.*指引|缺乏.*指引|无法.*选择/ },
          { key: 'change', name: '变更(带宽/网络类型)与欠费', re: /变更|带宽变更|欠费|自动续订|名称.*修改|移机|加急.*开通|预开通|建群|转派|协调/ },
          { key: 'renew', name: '续订入口/路径不直观', re: /续订入口|续订.*路径|续订操作|续订.*不清晰|自动续订|创建.*失败|创建时遭遇|订单状态|入口位置|未直观/ },
        ] },
      { key: 'perm', name: '权限/资源池/监控可见', re: /权限|资源池.*可见|灰度|账号.*开通|监控数据|无法查看.*监控|无法自助查|后台人工|人工介入|人工协助/,
        subs: [
          { key: 'perm', name: '权限/资源池可见/灰度', re: /权限|资源池.*可见|灰度|账号.*开通|人工介入|人工协助|后台人工/ },
          { key: 'monitor', name: '监控数据不可见', re: /监控数据|无法查看.*监控|无法自助查/ },
        ] },
      { key: 'support', name: '服务流程/支持渠道', re: /排查报告|电话支持|技术专家|响应.*不及时|处理闭环|咨询响应|服务流程|适用对象|申请条件|现象未记录|公开渠道获取|端口映射关系|无法直接获得|多轮沟通.*协调|流程长/,
        subs: [
          { key: 'report', name: '排查报告/现象记录', re: /排查报告|现象未记录|日志原因未明确/ },
          { key: 'channel', name: '支持渠道/响应', re: /电话支持|技术专家|响应.*不及时|咨询响应|无法直接获得|多轮沟通.*协调|流程长/ },
          { key: 'scope', name: '适用对象/申请条件不清', re: /适用对象|申请条件|服务流程/ },
        ] },
    ],
  },
  虚拟私有云: {
    families: [
      { key: 'sg', name: '安全组/ACL/网卡', re: /安全组|ACL|放通|流入协议|端口.*不通|默认安全组|删除.*安全组|网络ACL|网卡|解绑|绑定关系/,
        subs: [
          { key: 'sgrule', name: '安全组规则配置', re: /安全组规则|放通|流入协议|规则变更|规则配置|CIDR|IP范围|快捷放通/ },
          { key: 'sglimit', name: '安全组删除限制/状态不一致', re: /默认安全组.*删除|不可删除|状态.*不一致|置为不可见|删除按钮|残留|网卡无法解绑|解绑/ },
          { key: 'sgref', name: '典型配置指引(HAVIP/高可用)', re: /主从数据库|HAVIP|Keepalived|高可用|从库/ },
        ] },
      { key: 'iconn', name: '内网连通性', re: /内网.*不通|互通.*异常|同VPC|跨主机|端口访问|网络请求无法到达|无法远程|连接失败|端口.*中断|UDP.*丢包|RST|远程.*失败|网络链路质量差|网络中断|周期性网络|接口连通性|网络不稳定|时有时无|云主机间网络|云主机网络|网络连通性故障/,
        subs: [
          { key: 'samevpc', name: '同VPC/内网互通', re: /内网互通|同VPC|互通异常|内网.*不通|跨VPC/ },
          { key: 'port', name: '端口/协议不通', re: /端口.*不通|无法到达|UDP.*丢包|RST|远程.*失败|网络请求无法到达|接口连通性/ },
          { key: 'host', name: '底层宿主机/资源池', re: /宿主机|资源池|底层|网卡|残留|双进程|资源抢占|重装系统|边缘云|周期.*中断/ },
        ] },
      { key: 'dualstack', name: '双栈/IPv6/子网/路由', re: /IPv6|双栈|子网|路由优先级|策略路由|默认路由|防火墙.*流量|跨可用区子网|跨VPC子网|路由配置|路由表/,
        subs: [
          { key: 'ipv6', name: 'IPv6/双栈子网', re: /IPv6|双栈|子网/ },
          { key: 'route', name: '路由/防火墙引流', re: /路由优先级|策略路由|默认路由|防火墙.*流量|路由配置|路由表/ },
        ] },
      { key: 'peering', name: '对等连接/HAVIP', re: /对等连接|HAVIP|高可用|跨项目.*对账|互联方案/,
        subs: [
          { key: 'peer', name: '对等连接配额/互通', re: /对等连接|互联方案|跨项目/ },
          { key: 'havip', name: 'HAVIP配置', re: /HAVIP|高可用/ },
        ] },
      { key: 'quota', name: '配额不足/提升流程', re: /配额|上限|扩容申请|人工申请提升|人工审批提升|无法满足.*配额|配额默认值|配额调整|配额上限|配额用尽/,
        subs: [
          { key: 'qinsuff', name: '配额不足需人工提升', re: /配额不足|配额默认值|配额上限|配额用尽|配额调整|无法满足.*配额|人工申请提升|人工审批提升|扩容申请/ },
          { key: 'qtrans', name: '配额流程不透明', re: /流程不透明|流程繁琐|无预警|自助提升|二次上限|未明确.*上限|不一致.*流程/ },
        ] },
      { key: 'perm_order', name: '权限/订购/退订/删除', re: /权限|订购.*失败|资源池.*可见|灰度|退订|删除操作|删除入口|账号.*开通|可用区.*无法创建|可用区.*订购|信创|订购权限|创建VPC.*失败|控制台无法查询|清退|误判为异常|登录账号错误/,
        subs: [
          { key: 'perm', name: '权限/资源池可见/灰度', re: /权限|资源池.*可见|灰度|账号.*开通|订购权限|信创|控制台无法查询|清退|误判/ },
          { key: 'order', name: '订购失败/入口不直观', re: /订购.*失败|创建VPC.*失败|可用区.*无法创建|可用区.*订购|登录账号错误/ },
          { key: 'unsub', name: '退订/删除指引缺失', re: /退订|删除操作|删除入口|不熟悉.*退订|无法自行完成删除/ },
        ] },
      { key: 'billing_concept', name: '计费/概念误解', re: /计费模式|计费规则|费用|概念|VPC.*定义|误解|意外费用|自动购买.*计费|计费.*疑虑/,
        subs: [
          { key: 'bill', name: '计费规则疑虑', re: /计费模式|计费规则|费用|自动购买.*计费|计费.*疑虑|意外费用/ },
          { key: 'concept', name: '产品概念/操作误解', re: /概念|VPC.*定义|误解|不清晰.*VPC/ },
        ] },
      { key: 'pub', name: '公网/对象存储访问', re: /公网域名|对象存储|公网服务|访问权限配置|公网访问|公网IP默认/,
        subs: [
          { key: 'oss', name: '对象存储访问', re: /对象存储|公网域名/ },
          { key: 'pubperm', name: '公网访问权限', re: /公网服务|访问范围|访问权限|公网IP/ },
        ] },
    ],
  },
  弹性负载均衡: {
    families: [
      { key: 'cert', name: '证书与HTTPS配置', re: /证书|SSL|HTTPS|TLS|WAF|加密|HTTP.*后端|协议.*不匹配|443|前端.*后端|旧证书/,
        subs: [
          { key: 'replace', name: '证书替换/生效', re: /证书替换|证书未生效|旧证书|证书上传|证书格式|更换.*证书|waf.*证书|证书绑定/ },
          { key: 'proto', name: '协议/端口不匹配', re: /HTTP.*后端|协议.*不匹配|443端口|后端协议|前端与.*后端/ },
        ] },
      { key: 'fwd', name: '转发与连通性', re: /502|转发|负载失衡|端口.*不均衡|OPTIONS|IP.*无法访问|ARP|MAC|后端服务器|监听|流量不均衡|负载均衡IP/,
        subs: [
          { key: 'fwerr', name: '转发异常/502', re: /502|转发|后端服务|负载失衡|不均衡|调度/ },
          { key: 'cfail', name: '连通性失败', re: /IP.*无法访问|ARP|MAC|监听.*端口|访问中断|端口流量不均衡/ },
        ] },
      { key: 'mon', name: '监控与指标', re: /指标|监控|带宽利用率|告警|误报|口径|TLS流出|流出带宽|统计/,
        subs: [
          { key: 'metric', name: '指标异常', re: /指标异常|利用率|不一致|误报|口径|流出带宽/ },
          { key: 'alert', name: '告警', re: /告警/ },
        ] },
      { key: 'bill', name: '计费与订购', re: /计费|按量|费用|可用区|订购|资源不足|灰度|上架|审批|库存|取消/,
        subs: [
          { key: 'charge', name: '计费理解', re: /计费|按量|未使用.*计费|费用|金额/ },
          { key: 'orderaz', name: '可用区/资源', re: /可用区|订购失败|资源不足|库存|灰度码|上架|自动取消/ },
        ] },
      { key: 'diag', name: '诊断与日志能力', re: /日志|排查|根因|定位|处理日志|可追溯|自行查看/,
        subs: [
          { key: 'log', name: '日志查看', re: /日志|处理日志|自行查看/ },
          { key: 'root', name: '根因定位', re: /根因|定位|排查|可追溯/ },
        ] },
      { key: 'func', name: '功能与配置限制', re: /keepalive|proxy_socket|端口暴露|21.*22|配置要求|能力说明|选型|使用限制|不支持.*开启/,
        subs: [
          { key: 'feat', name: '功能不支持', re: /keepalive|proxy_socket|不支持.*开启|特定转发功能|迁移或替代/ },
          { key: 'expo', name: '端口暴露/指引', re: /端口暴露|21、22|使用限制|配置要求|能力说明|选型/ },
        ] },
      { key: 'security', name: '安全防护/封堵/白名单', re: /安全封堵|EDR|白名单|访问控制|封堵|被攻击|攻击源|安全防护/,
        subs: [
          { key: 'block', name: '安全封堵/误封', re: /安全封堵|封堵|被攻击|攻击源|白名单|访问控制/ },
          { key: 'edr', name: 'EDR/安全防护认知', re: /EDR|安全防护/ },
        ] },
      { key: 'quota', name: '配额/实例到期冻结', re: /配额|上限|冻结|到期|实例.*到期|默认配额|白名单条数|访问控制组配额/,
        subs: [
          { key: 'qinsuff', name: '配额不足需人工提升', re: /配额|上限|默认配额|白名单条数|访问控制组配额|手动申请/ },
          { key: 'freeze', name: '实例到期冻结', re: /冻结|到期|实例.*到期|续费窗口/ },
        ] },
      { key: 'api', name: 'API/文档', re: /API|字段.*含义|文档|返回值/,
        subs: [
          { key: 'api', name: 'API字段/文档不清', re: /API|字段.*含义|文档|返回值/ },
        ] },
    ],
  },
  弹性公网IP: {
    families: [
      { key: 'quota', name: '配额与数量', re: /配额|额度|共享带宽包关联IP|共享带宽包.*数量|数量限制|订购数量|关联IP个数|IP个数.*限制|有效期|带宽提升|带宽申请|数量上限|IP数量上限/,
        subs: [
          { key: 'validity', name: '配额有效期短/到期恢复', re: /有效期|14天|到期.*恢复|恢复原值|恢复原配额|重新申请|到期自动|有效期内未|自动续期|有效期短|有效期限制|到期恢复|需重新申请/ },
          { key: 'unsub_norecycle', name: '退订未回收配额', re: /退订.*配额|释放.*配额|配额.*释放|配额残留|未释放.*配额|退订.*未释放|释放对应资源池|配额回收/ },
          { key: 'nosefl', name: '无自助申请入口/流程', re: /自助申请|申请入口|控制台未提供.*申请|在线申请|审批进度|实时查看审批|无自助|自助提交|提升请求|配额管理页面|配额申请页面|在线提交/ },
          { key: 'insufficient', name: '配额不足/底层资源不足', re: /配额不足|初始值不足|底层资源不足|无法满足.*需求|资源池级配额|默认值低于|配额设置低于|资源不足.*配额|配额提升.*拒绝|无法提升配额|配额提升被拒绝/ },
          { key: 'opaque', name: '配额信息不透明/查询', re: /配额数值|有效期信息|配额信息不透明|自助查询配额|资源池.*配额信息|配额.*不透明|无法自助获取.*配额|配额.*查询|配额信息/ },
          { key: 'sharebw', name: '共享带宽包关联IP数量限制', re: /共享带宽包关联IP|关联IP个数|关联IP数量|共享带宽.*数量|IP个数.*限制|共享带宽包.*IP|共享带宽包关联/ },
          { key: 'qapprove', name: '配额审批依赖人工/流程慢', re: /人工审批|人工审批流程|依赖人工|审批流程|配额.*人工审批|配额提升.*人工|审批.*配额提升/ },
          { key: 'qexhaust', name: '配额用尽/超额', re: /配额.*用尽|配额已用尽|配额.*耗尽|可用额度|超出可用额度|配额上限已到|配额.*超出|剩余.*负|配额.*已满/ },
          { key: 'qratio', name: 'vCPU:IP 比例限制', re: /比例限制|8:1|8比1|8：1|vCPU.*IP|CPU配额.*限制|IP数量.*比例|按比例.*限制/ },
          { key: 'qpoolcap', name: '资源池级配额上限过低', re: /资源池.*配额.*上限|订购配额上限|资源池级.*上限|全局.*配额|未区分资源池独立配额|配额未区分资源池/ },
        ] },
      { key: 'avail', name: '资源可用性/售罄下架', re: /售罄|库存不足|库存售罄|资源池售罄|下架|扩容未完成|底层.*空闲地址|资源.*不可用|资源池.*满/, subs: [] },
      { key: 'bwscale', name: '带宽升降配', re: /扩容|升配|降配|带宽调整|带宽变更|调整带宽|带宽升?级|带宽升降配|带宽资源不足|带宽不足|带宽容量|提升带宽|开通.*带宽|带宽.*订购需求|带宽.*打满/, subs: [] },
      { key: 'create', name: '创建/申购 EIP', re: /创建|申购|新购|开通弹性公网IP|购买弹性公网IP|订购弹性公网IP|申请创建|创建EIP|创建弹性公网IP|申购带宽包|新购弹性公网IP|新增.*公网IP|新增.*共享带宽|新增.*带宽/, subs: [] },
      { key: 'gray', name: '灰度与订购权限', re: /灰度|订购权限|体验期|下单需审核|免费体验|审核中|订购资格|订购审批|账号受限|账号.*受限/, subs: [] },
      { key: 'netloss', name: '网络质量与丢包', re: /丢包|网络质量|时延|延迟|拥塞|轻载|异网|卡顿|抖动|性能|速率|超时|测速|带宽超限|带宽利用率|带宽异常|带宽不符|带宽未达|带宽不满足|下载速率|上传速率|下载速度|上传速度|访问慢|性能差|性能下降|访问性能|不稳定|瓶颈|中断|诊断|故障定位|定位手段|根因|自助诊断|iperf|打流|测速网站|带宽.*预期|带宽.*要求|SFTP|RST|TCP会话|带宽.*波动|流量突增|异常流量|网络故障|周期性|打满/,
        subs: [
          { key: 'bw_mismatch', name: '带宽不符预期/带宽打满', re: /带宽不符|带宽未达|带宽不满足|带宽异常|带宽超限|带宽利用率|带宽.*预期|带宽.*要求|带宽.*打满|下载速率|上传速率|下载速度|上传速度|实际带宽|标称带宽|速率.*不符|速率.*达不到|带宽.*差异|性能.*超限/ },
          { key: 'congestion', name: '网络拥塞/轻载通道不足', re: /拥塞|拥堵|瓶颈|流量突增|异常流量|轻载|满负荷|高峰期.*拥塞|异网.*拥塞|卡顿/ },
          { key: 'loss', name: '丢包', re: /丢包|丢帧|packet loss|丢包率/ },
          { key: 'latency', name: '时延/延迟', re: /时延|延迟|延时|RTT|响应慢|访问慢/ },
          { key: 'jitter', name: '抖动/不稳定', re: /抖动|不稳定|波动|忽快忽慢|周期性|间歇性/ },
          { key: 'outage', name: '中断/链路故障', re: /中断|网络故障|故障|断链|断流|断开|网络不可达|连接.*中断|链路.*中断/ },
        ] },
      { key: 'conn', name: '公网访问连通性', re: /访问不通|不可达|访问异常|连通性|公网访问|无法访问|访问.*失败|网络不可达|间歇.*不通|部分源地址|连接超时|无法通过NAT|无法访问公网|访问公网|端口.*不通|特定源IP.*不可达|对端未响应|特定IP.*不通|网站.*超时|可达性|未响应|回包|特定源IP|对端服务器|ICMP/, subs: [] },
      { key: 'bind', name: '绑定/解绑云资源', re: /绑定|解绑|关联云主机|绑定云主机|解绑云资源|绑定云资源|解绑.*IP|加入共享带宽|删除IP|共享带宽.*未生效|共享带宽.*操作/, subs: [] },
      { key: 'billing', name: '计费与账单', re: /计费|账单|费用|计费模式|保有费|费用明细|包月.*费|续费|续订|费用异常|折扣|抵扣|资费|价格/, subs: [] },
      { key: 'freeze', name: '资源到期冻结与提醒', re: /冻结|资源停用|到期.*中断|停服|到期冻结|冻结期|提前预警|到期提醒|续费提醒|资源冻结/, subs: [] },
      { key: 'doc', name: '文档与指引', re: /文档|指引|SDK|API文档|字段类型|开发集成|接口文档|说明不一致|文档缺失/, subs: [] },
      { key: 'sec', name: '安全防护与访问控制', re: /DDoS|清洗|防火墙|封堵|攻击|白名单|访问控制|安全组|安全防护/, subs: [] },
      { key: 'unsub', name: '退订/释放资源', re: /退订|释放资源|释放.*IP|退订.*释放|释放弹性公网IP|退订弹性公网IP/, subs: [] },
      { key: 'monitor', name: '流量与监控查询', re: /监控|流量查询|拨测|使用率查询|用量查询|流量与监控|监控查询|资源监控|流量回溯|历史流量|镜像|回溯流量|回溯/, subs: [] },
      { key: 'spec', name: '产品规格与线路咨询', re: /线路类型|BGP|三网|单线|多线|接入方式|抵扣规则|防护节点|产品信息不透明|是否支持.*接入|线路.*特性|线路.*疑问/, subs: [] },
    ],
  },
};

// =========================================================================
// EIP 原因优先分类法（从 validate-action-recs.cjs L283-586 原样移出）
// =========================================================================

const EIP_CAUSE_TAX = { '弹性公网IP': { families: [
  { key: 'connect', name: '公网连通与路由',
    re: /访问不通|不可达|访问异常|连通性|公网访问|无法访问|访问.*失败|网络不可达|间歇.*不通|部分源地址|连接超时|无法通过NAT|无法访问公网|访问公网|端口.*不通|特定源IP.*不可达|对端未响应|特定IP.*不通|网站.*超时|可达性|未响应|回包|特定源IP|对端服务器|ICMP|路由|NAT|to-nat|配置异常|配置.*错误|参数.*错误|配置不当|路由表.*添加|添加.*路由|配置.*路由|防火墙.*拦截/,
    subs: [
      { key: 'unreach', name: '公网不可达/访问不通', re: /访问不通|不可达|访问异常|公网访问|无法访问|访问.*失败|网络不可达|间歇.*不通|部分源地址|连接超时|无法通过NAT|无法访问公网|访问公网|端口.*不通|特定源IP.*不可达|对端未响应|特定IP.*不通|网站.*超时|可达性|未响应|回包|特定源IP|对端服务器|ICMP/ },
      { key: 'route_nat', name: '路由/NAT/配置异常', re: /路由|NAT|to-nat|配置异常|配置.*错误|参数.*错误|配置不当|路由表.*添加|添加.*路由|配置.*路由|防火墙.*拦截/ },
    ] },
  { key: 'netloss', name: '网络链路质量',
    re: /丢包|网络质量|时延|延迟|拥塞|轻载|异网|卡顿|抖动|性能|速率|超时|测速|带宽超限|带宽利用率|带宽异常|带宽不符|带宽未达|带宽不满足|下载速率|上传速率|下载速度|上传速度|访问慢|性能差|性能下降|访问性能|不稳定|瓶颈|中断|诊断|故障定位|定位手段|根因|自助诊断|iperf|打流|测速网站|带宽.*预期|带宽.*要求|SFTP|RST|TCP会话|带宽.*波动|流量突增|异常流量|网络故障|周期性|打满|ping|mtr|trace|traceroute|网络不稳/,
    subs: [
      { key: 'bw_mismatch', name: '带宽不符预期', re: /带宽不符|带宽未达|带宽不满足|带宽异常|带宽超限|带宽利用率|带宽.*预期|带宽.*要求|带宽.*打满|下载速率|上传速率|下载速度|上传速度|实际带宽|标称带宽|速率.*不符|速率.*达不到|带宽.*差异|性能.*超限/ },
      { key: 'congestion', name: '网络拥塞/轻载通道不足', re: /拥塞|拥堵|瓶颈|流量突增|异常流量|轻载|满负荷|高峰期.*拥塞|异网.*拥塞|卡顿/ },
      { key: 'loss', name: '丢包', re: /丢包|丢帧|packet loss|丢包率/ },
      { key: 'latency', name: '时延/延迟', re: /时延|延迟|延时|RTT|响应慢|访问慢/ },
      { key: 'jitter', name: '抖动/不稳定', re: /抖动|不稳定|波动|忽快忽慢|周期性|间歇性/ },
      { key: 'outage', name: '中断/链路故障', re: /中断|网络故障|故障|断链|断流|断开|网络不可达|连接.*中断|链路.*中断/ },
    ] },
  { key: 'quota', name: '配额与数量限制',
    re: /配额|额度|共享带宽包关联IP|共享带宽包.*数量|数量限制|订购数量|关联IP个数|IP个数.*限制|有效期|带宽提升|带宽申请|数量上限|IP数量上限|配额不足|初始值不足|底层资源不足|无法满足.*需求|资源池级配额|默认值低于|配额设置低于|资源不足.*配额|配额提升.*拒绝|无法提升配额|配额提升被拒绝|配额.*用尽|配额已用尽|配额.*耗尽|可用额度|超出可用额度|比例限制|8:1|8比1|8：1|vCPU.*IP|CPU配额.*限制|IP数量.*比例|按比例.*限制|资源池.*配额.*上限|订购配额上限|资源池级.*上限|全局.*配额|未区分资源池独立配额|配额未区分资源池|人工审批|人工审批流程|依赖人工|审批流程|配额.*人工审批|配额提升.*人工|审批.*配额提升|自助申请|申请入口|控制台未提供.*申请|在线申请|审批进度|实时查看审批|无自助|自助提交|提升请求|配额管理页面|配额申请页面|在线提交|配额数值|有效期信息|配额信息不透明|自助查询配额|资源池.*配额信息|配额.*不透明|无法自助获取.*配额|配额.*查询|配额信息|有效期短|到期.*恢复|恢复原值|恢复原配额|重新申请|到期自动|有效期内未|自动续期|有效期限制|到期恢复|需重新申请|退订.*配额|释放.*配额|配额.*释放|配额残留|未释放.*配额|退订.*未释放|释放对应资源池|配额回收/,
    subs: [
      { key: 'qinsuff', name: '配额不足/底层资源不足', re: /配额不足|初始值不足|底层资源不足|无法满足.*需求|资源池级配额|默认值低于|配额设置低于|资源不足.*配额|配额提升.*拒绝|无法提升配额|配额提升被拒绝/ },
      { key: 'qexhaust', name: '配额用尽/超额', re: /配额.*用尽|配额已用尽|配额.*耗尽|可用额度|超出可用额度|配额上限已到|配额.*超出|剩余.*负|配额.*已满/ },
      { key: 'qapprove', name: '配额审批依赖人工', re: /人工审批|人工审批流程|依赖人工|审批流程|配额.*人工审批|配额提升.*人工|审批.*配额提升/ },
      { key: 'nosefl', name: '无自助申请入口', re: /自助申请|申请入口|控制台未提供.*申请|在线申请|审批进度|实时查看审批|无自助|自助提交|提升请求|配额管理页面|配额申请页面|在线提交/ },
      { key: 'opaque', name: '配额信息不透明', re: /配额数值|有效期信息|配额信息不透明|自助查询配额|资源池.*配额信息|配额.*不透明|无法自助获取.*配额|配额.*查询|配额信息/ },
      { key: 'validity', name: '配额有效期短/到期恢复', re: /有效期|14天|到期.*恢复|恢复原值|恢复原配额|重新申请|到期自动|有效期内未|自动续期|有效期短|有效期限制|到期恢复|需重新申请/ },
      { key: 'unsub_norecycle', name: '退订未回收配额', re: /退订.*配额|释放.*配额|配额.*释放|配额残留|未释放.*配额|退订.*未释放|释放对应资源池|配额回收/ },
      { key: 'sharebw', name: '共享带宽包关联IP限制', re: /共享带宽包关联IP|关联IP个数|关联IP数量|共享带宽.*数量|IP个数.*限制|共享带宽包.*IP|共享带宽包关联/ },
      { key: 'qratio', name: 'vCPU:IP比例限制', re: /比例限制|8:1|8比1|8：1|vCPU.*IP|CPU配额.*限制|IP数量.*比例|按比例.*限制/ },
      { key: 'qpoolcap', name: '资源池级配额上限过低', re: /资源池.*配额.*上限|订购配额上限|资源池级.*上限|全局.*配额|未区分资源池独立配额|配额未区分资源池/ },
    ] },
  { key: 'avail', name: '资源可用性/售罄下架',
    re: /售罄|库存不足|库存售罄|资源池售罄|下架|扩容未完成|底层.*空闲地址|资源.*不可用|资源池.*满/,
    subs: [] },
  { key: 'bwscale', name: '带宽升降配',
    re: /扩容|升配|降配|带宽调整|带宽变更|调整带宽|带宽升?级|带宽升降配|带宽资源不足|带宽不足|带宽容量|提升带宽|开通.*带宽|带宽.*订购需求|带宽.*打满/,
    subs: [] },
  { key: 'create', name: '开通与交付',
    re: /创建|申购|新购|开通弹性公网IP|购买弹性公网IP|订购弹性公网IP|申请创建|创建EIP|创建弹性公网IP|申购带宽包|新购弹性公网IP|新增.*公网IP|新增.*共享带宽|新增.*带宽/,
    subs: [] },
  { key: 'gray', name: '灰度/订购权限',
    re: /灰度|订购权限|体验期|下单需审核|免费体验|审核中|订购资格|订购审批|账号受限|账号.*受限/,
    subs: [] },
  { key: 'bind', name: '关联资源绑定',
    re: /绑定|解绑|关联云主机|绑定云主机|解绑云资源|绑定云资源|解绑.*IP|加入共享带宽|删除IP|共享带宽.*未生效|共享带宽.*操作/,
    subs: [] },
  { key: 'billing', name: '计费与账单',
    re: /计费|账单|费用|计费模式|保有费|费用明细|包月.*费|续费|续订|费用异常|折扣|抵扣|资费|价格/,
    subs: [] },
  { key: 'freeze', name: '资源到期冻结与续订',
    re: /冻结|资源停用|到期.*中断|停服|到期冻结|冻结期|提前预警|到期提醒|续费提醒|资源冻结/,
    subs: [] },
  { key: 'unsub', name: '退订与资源释放',
    re: /退订|释放资源|释放.*IP|退订.*释放|释放弹性公网IP|退订弹性公网IP/,
    subs: [] },
  { key: 'sec', name: '安全防护与访问控制',
    re: /DDoS|清洗|防火墙|封堵|攻击|白名单|访问控制|安全组|安全防护/,
    subs: [] },
  { key: 'monitor', name: '流量与监控查询',
    re: /监控|流量查询|拨测|使用率查询|用量查询|流量与监控|监控查询|资源监控|流量回溯|历史流量|镜像|回溯流量|回溯/,
    subs: [] },
  { key: 'doc', name: '文档与API',
    re: /文档|指引|SDK|API文档|字段类型|开发集成|接口文档|说明不一致|文档缺失/,
    subs: [] },
  { key: 'spec', name: '产品规格与线路',
    re: /线路类型|BGP|三网|单线|多线|接入方式|抵扣规则|防护节点|产品信息不透明|是否支持.*接入|线路.*特性|线路.*疑问/,
    subs: [] },
] } };

// 云专线 / VPC / ELB 原因优先分类法（原样从 validate-action-recs.cjs 移出）
const DC_CAUSE_TAX = { '云专线': { families: [
  { key: 'conn', name: '连通性与网络质量',
    re: /断连|断网|网络连|链路|丢包|时延|延迟|网络质量|带宽未达|带宽不足|网络性能|连通|互访|中断|卡顿|抖动|ping|trace|mtr|专线.*不通|无法访问.*专线|专线.*故障|对端不|两端无法|网络波动|网络不稳|时有时无|网络中断/,
    subs: [
      { key: 'interrupt', name: '专线中断/断连', re: /中断|断连|断网|专线.*不通|链路中断|连接中断|频繁断|网络中断|网络波动|时有时无/ },
      { key: 'loss', name: '丢包', re: /丢包|丢包率|重传/ },
      { key: 'latency', name: '时延/延迟', re: /时延|延迟|卡顿/ },
      { key: 'bw', name: '带宽未达预期', re: /带宽未达|带宽不足|带宽.*预期|网络性能未达|带宽.*跑满/ },
    ] },
  { key: 'config', name: '配置与接入限制',
    re: /虚拟网关|VPC.*关联|对等连接|路由优先级|路由配置|网关|关联.*VPC|子网后网络不通|BGP|光模块|对接端|加密|容灾|跨境|国外线路|国际|节点地域|地域|接入节点|配置要求|操作指引|网络打通|互联|带宽升级|边缘云|接入网络类型|开通需求|接入类型/,
    subs: [
      { key: 'vpc', name: 'VPC关联限制', re: /仅支持.*VPC|关联.*VPC|虚拟网关|对等连接|网段转发|接入类型|网络打通|互联/ },
      { key: 'route', name: '路由/BGP配置', re: /路由优先级|路由配置|路由.*转发|BGP|本端.*云端路由/ },
      { key: 'cap', name: '产品能力/覆盖/文档', re: /能力说明|官方信息|文档|加密|容灾|光模块|对接端|国际|国外线路|跨境|带宽升级.*可行|边缘云|节点地域|地域|接入节点/ },
    ] },
  { key: 'order_flow', name: '订购与变更流程',
    re: /续订|订购|变更|开通|带宽变更|资费|订单进度|订单状态|自动续订|到期冻结|名称.*修改|移机|自动注销|创建.*失败|创建时遭遇|未直观|入口位置|操作路径|续订.*操作|客户经理|渠道|欠费|加急.*开通|预开通|建群|转派|服务区域|注册中|商机|审批|意向|开通时限|协调|流程.*不透明|流程.*指引|缺乏.*指引|无法.*选择.*区域|对端未审批/,
    subs: [
      { key: 'open', name: '开通/订购渠道与指引', re: /订购|开通|意向|客户经理|渠道|跨境|节点|地域|服务区域|注册中|商机|审批|对端未审批|开通时限|资费|订单进度|流程.*不透明|流程.*指引|缺乏.*指引|无法.*选择/ },
      { key: 'change', name: '变更与欠费', re: /变更|带宽变更|欠费|自动续订|名称.*修改|移机|加急.*开通|预开通|建群|转派|协调/ },
      { key: 'renew', name: '续订入口/路径不直观', re: /续订入口|续订.*路径|续订操作|续订.*不清晰|自动续订|创建.*失败|创建时遭遇|订单状态|入口位置|未直观/ },
    ] },
  { key: 'billing', name: '计费与折扣',
    re: /计费|折扣|包年转|转包月|账单|费用|收费|价格|超限折扣/,
    subs: [
      { key: 'convert', name: '包年转包月', re: /包年转|转包月|计费模式|转换|订购时间.*早于/ },
      { key: 'discount', name: '折扣未生效', re: /折扣|未生效|超限折扣|计费规则|账单中/ },
    ] },
  { key: 'perm', name: '权限/资源池/监控可见',
    re: /权限|资源池.*可见|灰度|账号.*开通|监控数据|无法查看.*监控|无法自助查|后台人工|人工介入|人工协助/,
    subs: [
      { key: 'perm', name: '权限/资源池可见/灰度', re: /权限|资源池.*可见|灰度|账号.*开通|人工介入|人工协助|后台人工/ },
      { key: 'monitor', name: '监控数据不可见', re: /监控数据|无法查看.*监控|无法自助查/ },
    ] },
  { key: 'support', name: '服务流程/支持渠道',
    re: /排查报告|电话支持|技术专家|响应.*不及时|处理闭环|咨询响应|服务流程|适用对象|申请条件|现象未记录|公开渠道获取|端口映射关系|无法直接获得|多轮沟通.*协调|流程长/,
    subs: [
      { key: 'report', name: '排查报告/现象记录', re: /排查报告|现象未记录|日志原因未明确/ },
      { key: 'channel', name: '支持渠道/响应', re: /电话支持|技术专家|响应.*不及时|咨询响应|无法直接获得|多轮沟通.*协调|流程长/ },
      { key: 'scope', name: '适用对象/申请条件不清', re: /适用对象|申请条件|服务流程/ },
    ] },
] } };

const VPC_CAUSE_TAX = { '虚拟私有云': { families: [
  { key: 'sg', name: '安全组/ACL/网卡',
    re: /安全组|ACL|放通|流入协议|端口.*不通|默认安全组|删除.*安全组|网络ACL|网卡|解绑|绑定关系/,
    subs: [
      { key: 'sgrule', name: '安全组规则配置', re: /安全组规则|放通|流入协议|规则变更|规则配置|CIDR|IP范围|快捷放通/ },
      { key: 'sglimit', name: '安全组删除限制/状态不一致', re: /默认安全组.*删除|不可删除|状态.*不一致|置为不可见|删除按钮|残留|网卡无法解绑|解绑/ },
      { key: 'sgref', name: '典型配置指引(HAVIP/高可用)', re: /主从数据库|HAVIP|Keepalived|高可用|从库/ },
    ] },
  { key: 'iconn', name: '内网连通性',
    re: /内网.*不通|互通.*异常|同VPC|跨主机|端口访问|网络请求无法到达|无法远程|连接失败|端口.*中断|UDP.*丢包|RST|远程.*失败|网络链路质量差|网络中断|周期性网络|接口连通性|网络不稳定|时有时无|云主机间网络|云主机网络|网络连通性故障/,
    subs: [
      { key: 'samevpc', name: '同VPC/内网互通', re: /内网互通|同VPC|互通异常|内网.*不通|跨VPC/ },
      { key: 'port', name: '端口/协议不通', re: /端口.*不通|无法到达|UDP.*丢包|RST|远程.*失败|网络请求无法到达|接口连通性/ },
      { key: 'host', name: '底层宿主机/资源池', re: /宿主机|资源池|底层|网卡|残留|双进程|资源抢占|重装系统|边缘云|周期.*中断/ },
    ] },
  { key: 'dualstack', name: '双栈/IPv6/子网/路由',
    re: /IPv6|双栈|子网|路由优先级|策略路由|默认路由|防火墙.*流量|跨可用区子网|跨VPC子网|路由配置|路由表/,
    subs: [
      { key: 'ipv6', name: 'IPv6/双栈子网', re: /IPv6|双栈|子网/ },
      { key: 'route', name: '路由/防火墙引流', re: /路由优先级|策略路由|默认路由|防火墙.*流量|路由配置|路由表/ },
    ] },
  { key: 'peering', name: '对等连接/HAVIP',
    re: /对等连接|HAVIP|高可用|跨项目.*对账|互联方案/,
    subs: [
      { key: 'peer', name: '对等连接配额/互通', re: /对等连接|互联方案|跨项目/ },
      { key: 'havip', name: 'HAVIP配置', re: /HAVIP|高可用/ },
    ] },
  { key: 'quota', name: '配额不足/提升流程',
    re: /配额|上限|扩容申请|人工申请提升|人工审批提升|无法满足.*配额|配额默认值|配额调整|配额上限|配额用尽/,
    subs: [
      { key: 'qinsuff', name: '配额不足需人工提升', re: /配额不足|配额默认值|配额上限|配额用尽|配额调整|无法满足.*配额|人工申请提升|人工审批提升|扩容申请/ },
      { key: 'qtrans', name: '配额流程不透明', re: /流程不透明|流程繁琐|无预警|自助提升|二次上限|未明确.*上限|不一致.*流程/ },
    ] },
  { key: 'perm_order', name: '权限/订购/退订/删除',
    re: /权限|订购.*失败|资源池.*可见|灰度|退订|删除操作|删除入口|账号.*开通|可用区.*无法创建|可用区.*订购|信创|订购权限|创建VPC.*失败|控制台无法查询|清退|误判为异常|登录账号错误/,
    subs: [
      { key: 'perm', name: '权限/资源池可见/灰度', re: /权限|资源池.*可见|灰度|账号.*开通|订购权限|信创|控制台无法查询|清退|误判/ },
      { key: 'order', name: '订购失败/入口不直观', re: /订购.*失败|创建VPC.*失败|可用区.*无法创建|可用区.*订购|登录账号错误/ },
      { key: 'unsub', name: '退订/删除指引缺失', re: /退订|删除操作|删除入口|不熟悉.*退订|无法自行完成删除/ },
    ] },
  { key: 'billing_concept', name: '计费/概念误解',
    re: /计费模式|计费规则|费用|概念|VPC.*定义|误解|意外费用|自动购买.*计费|计费.*疑虑/,
    subs: [
      { key: 'bill', name: '计费规则疑虑', re: /计费模式|计费规则|费用|自动购买.*计费|计费.*疑虑|意外费用/ },
      { key: 'concept', name: '产品概念/操作误解', re: /概念|VPC.*定义|误解|不清晰.*VPC/ },
    ] },
  { key: 'pub', name: '公网/对象存储访问',
    re: /公网域名|对象存储|公网服务|访问权限配置|公网访问|公网IP默认/,
    subs: [
      { key: 'oss', name: '对象存储访问', re: /对象存储|公网域名/ },
      { key: 'pubperm', name: '公网访问权限', re: /公网服务|访问范围|访问权限|公网IP/ },
    ] },
] } };

const ELB_CAUSE_TAX = { '弹性负载均衡': { families: [
  { key: 'cert', name: '证书与HTTPS配置',
    re: /证书|SSL|HTTPS|TLS|WAF|加密|HTTP.*后端|协议.*不匹配|443|前端.*后端|旧证书/,
    subs: [
      { key: 'replace', name: '证书替换/生效', re: /证书替换|证书未生效|旧证书|证书上传|证书格式|更换.*证书|waf.*证书|证书绑定/ },
      { key: 'proto', name: '协议/端口不匹配', re: /HTTP.*后端|协议.*不匹配|443端口|后端协议|前端与.*后端/ },
    ] },
  { key: 'fwd', name: '转发与连通性',
    re: /502|转发|负载失衡|端口.*不均衡|OPTIONS|IP.*无法访问|ARP|MAC|后端服务器|监听|流量不均衡|负载均衡IP/,
    subs: [
      { key: 'fwerr', name: '转发异常/502', re: /502|转发|后端服务|负载失衡|不均衡|调度/ },
      { key: 'cfail', name: '连通性失败', re: /IP.*无法访问|ARP|MAC|监听.*端口|访问中断|端口流量不均衡/ },
    ] },
  { key: 'mon', name: '监控与指标',
    re: /指标|监控|带宽利用率|告警|误报|口径|TLS流出|流出带宽|统计/,
    subs: [
      { key: 'metric', name: '指标异常', re: /指标异常|利用率|不一致|误报|口径|流出带宽/ },
      { key: 'alert', name: '告警', re: /告警/ },
    ] },
  { key: 'bill', name: '计费与订购',
    re: /计费|按量|费用|可用区|订购|资源不足|灰度|上架|审批|库存|取消/,
    subs: [
      { key: 'charge', name: '计费理解', re: /计费|按量|未使用.*计费|费用|金额/ },
      { key: 'orderaz', name: '可用区/资源', re: /可用区|订购失败|资源不足|库存|灰度码|上架|自动取消/ },
    ] },
  { key: 'diag', name: '诊断与日志能力',
    re: /日志|排查|根因|定位|处理日志|可追溯|自行查看/,
    subs: [
      { key: 'log', name: '日志查看', re: /日志|处理日志|自行查看/ },
      { key: 'root', name: '根因定位', re: /根因|定位|排查|可追溯/ },
    ] },
  { key: 'func', name: '功能与配置限制',
    re: /keepalive|proxy_socket|端口暴露|21.*22|配置要求|能力说明|选型|使用限制|不支持.*开启/,
    subs: [
      { key: 'feat', name: '功能不支持', re: /keepalive|proxy_socket|不支持.*开启|特定转发功能|迁移或替代/ },
      { key: 'expo', name: '端口暴露/指引', re: /端口暴露|21、22|使用限制|配置要求|能力说明|选型/ },
    ] },
  { key: 'security', name: '安全防护/封堵/白名单',
    re: /安全封堵|EDR|白名单|访问控制|封堵|被攻击|攻击源|安全防护/,
    subs: [
      { key: 'block', name: '安全封堵/误封', re: /安全封堵|封堵|被攻击|攻击源|白名单|访问控制/ },
      { key: 'edr', name: 'EDR/安全防护认知', re: /EDR|安全防护/ },
    ] },
  { key: 'quota', name: '配额/实例到期冻结',
    re: /配额|上限|冻结|到期|实例.*到期|默认配额|白名单条数|访问控制组配额/,
    subs: [
      { key: 'qinsuff', name: '配额不足需人工提升', re: /配额|上限|默认配额|白名单条数|访问控制组配额|手动申请/ },
      { key: 'freeze', name: '实例到期冻结', re: /冻结|到期|实例.*到期|续费窗口/ },
    ] },
  { key: 'api', name: '文档与API',
    re: /API|字段.*含义|文档|返回值/,
    subs: [
      { key: 'api', name: 'API字段/文档不清', re: /API|字段.*含义|文档|返回值/ },
    ] },
] } };

// 四产品统一分类法映射
const CAUSE_TAX_MAP = {
  '弹性公网IP': EIP_CAUSE_TAX['弹性公网IP'],
  '云专线': DC_CAUSE_TAX['云专线'],
  '虚拟私有云': VPC_CAUSE_TAX['虚拟私有云'],
  '弹性负载均衡': ELB_CAUSE_TAX['弹性负载均衡'],
};

// 加载 curated 分类法（从 JSON 文件，运行时加载）
let _curatedMtime = 0;
function loadCuratedAll(scriptDir) {
  const dir = scriptDir || __dirname;
  const files = [
    ['弹性公网IP', 'eip-taxonomy-curated.json'],
    ['云专线', 'ct-taxonomy-curated.json'],
    ['虚拟私有云', 'vpc-taxonomy-curated.json'],
    ['弹性负载均衡', 'elb-taxonomy-curated.json'],
  ];
  // 检查最新 mtime，文件没变则跳过（支持热重载）
  let newestMtime = 0;
  for (const [, file] of files) {
    try {
      const st = fs.statSync(path.resolve(dir, file));
      if (st.mtimeMs > newestMtime) newestMtime = st.mtimeMs;
    } catch { /* file not found */ }
  }
  if (newestMtime > 0 && newestMtime <= _curatedMtime) return;
  _curatedMtime = newestMtime;
  const toRe = s => new RegExp(s, 'i');
  for (const [prod, file] of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.resolve(scriptDir || __dirname, file), 'utf8'));
      const fams = raw.families.map(f => ({
        key: f.key, name: f.name, re: toRe(f.re), rec: f.rec || '',
        reExc: f.exclude ? toRe(f.exclude) : null,
        phrases: (f.phrases || []).map(p => ({ re: toRe(p) })),
        subs: (f.subs || []).map(s => ({ key: s.key, name: s.name, re: toRe(s.re), rec: s.rec || '', reExc: s.exclude ? toRe(s.exclude) : null, phrases: (s.phrases || []).map(p => ({ re: toRe(p) })) })),
      }));
      CAUSE_TAX_MAP[prod] = { curated: true, families: fams };
    } catch (e) { /* 加载失败回退内置 */ }
  }
}

const OVERRIDES_PATH = path.resolve(__dirname, '..', 'taxonomy-overrides.json');
function loadOverrides() {
  try { return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')); } catch { return {}; }
}
function applyOverrides(tax, ov) {
  if (!ov || !ov.families) return tax;
  const famByName = new Map(tax.families.map(f => [f.name, f]));
  for (const famOv of ov.families) {
    const fam = famOv.key ? tax.families.find(f => f.key === famOv.key) : famByName.get(famOv.name);
    if (!fam) continue;
    if (famOv.re != null) { try { fam.re = new RegExp(famOv.re, fam.re.flags); } catch { /* 非法正则跳过 */ } }
    if (Array.isArray(famOv.addSubs)) {
      for (const s of famOv.addSubs) {
        if (fam.subs.some(x => x.key === s.key)) continue;
        try { fam.subs.push({ key: s.key, name: s.name, re: new RegExp(s.re) }); } catch { /* skip */ }
      }
    }
  }
  return tax;
}

// =========================================================================
// 自动 L2 细分器（从 validate-action-recs.cjs L663-990 原样移出）
// =========================================================================

const STOP = new Set([
  '客户', '反馈', '问题', '无法', '需要', '处理', '情况', '导致', '影响', '进行', '通过', '没有', '不是',
  '我们', '他们', '这个', '那个', '什么', '怎么', '可以', '应该', '已经', '还是', '因为', '所以', '但是', '而且',
  '相关', '目前', '出现', '存在', '使用', '操作', '功能', '需求', '咨询', '申请', '协助', '确认', '查看', '提供',
  '业务', '资源', '信息', '系统', '平台', '页面', '流程', '人员', '时间', '方式', '内容', '结果', '原因', '状态',
  '支持', '服务', '产品', '用户', '实际', '直接', '及时', '尽快', '沟通', '联系', '回复', '告知', '说明', '了解',
  '以及', '或者', '如果', '由于', '对于', '关于', '工程师', '排查', '定位', '解决', '优化', '提升', '增加', '减少',
  '调整', '修改', '完善', '希望', '要求', '表示', '反映', '描述', '现象', '场景', '环境', '版本', '设置',
  '异常', '网络', '主机', '服务器', '设备', '面临', '故障', '影响', '中断', '失败', '报错', '请求', '返回',
  '人工', '缺乏', '满足', '数据', '进行', '获取', '实现', '出现', '知道', '发现', '认为', '担心',
  '明确', '清晰', '不同', '相同', '一样', '部分', '全部', '多个', '单个', '各种', '若干',
]);
const FUNC_HEAD = /^[的了和与或在是为不有我你他她它们这那其之并于以对被把从到让使给等再又很太更最就都也还只才却]/;
const FUNC_TAIL = /[的了和与或在是为不有这那其之于以对被把从到等再又很太更最就都也还只才]$/;
const HAS_HAN = /[\u4e00-\u9fa5]/;
const NOISE = [
  '请', '帮', '需要', '协助', '处理', '咨询', '操作', '使用', '功能', '业务', '资源',
  '客户', '用户', '反馈', '问题', '情况', '处理', '需要', '进行', '影响',
];
const PROBLEM_CUE = /不支持|无法|不足|受限|超限|未留存|未释放|未提供|未达预期|缺失|无(入口|功能|自助)|需人工|人工审批|计划部审批|不透明|失败|异常|拒绝|冻结|不提供|不可见|限制|冷静期|保留期|瓶颈|不符|波动|不稳定|卡顿|不可行|未开放|无自助/;
const CAUSAL_REJECT = /^(导致|造成|引起|使得|由于|鉴于|从而|进而|故此|为此|订单因|客户因|系统因|平台因|用户因|账户因|账号因|业务因|实例因|资源因|产品因|需求因|问题因)/;
const PATIENT_PREFIX = /^(客户|用户|订单|账户|账号|实例|IP|业务|产品|资源|带宽|网络|接口|主机|流量|数据|信息|公网|共享|弹性|实例)/;
const SUBSTANCE = /数据|流量|资源|留存|释放|降配|退订|入口|配额|带宽|审批|机制|镜像|容量|规格|生效|冷静期|保留期|限制|故障|异常|中断|丢包|时延|抖动|拥塞|生效时间|释放机制|自助/;
const ENDS_WITH_CUE = /(不支持|无法|不足|未释放|未留存|无自助|无入口|无功能|需人工|不提供|不可见|不透明|冻结|拒绝|异常|失败|受限|超限|缺失|瓶颈|冷静期|保留期|不可行|未开放|未达预期|未提供)$/;
const PATIENT_NEG_END = /(无法|不支持|不能|不可|无(入口|功能|自助)|需人工|未(提供|释放|留存|达预期|开放)|不(支持|提供|可见|透明)|冻结|拒绝|异常|失败)$/;

function cueWeight(q) {
  if (PROBLEM_CUE.test(q)) return 2;
  if (ENDS_WITH_CUE.test(q)) return 2;
  if (SUBSTANCE.test(q)) return 1.5;
  return 1;
}
function cleanText(s) {
  return String(s || '').replace(/[##]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}
function segsOf(r) {
  const reason = cleanReason(get(r, '问题原因'));
  const pain = get(r, '需求痛点');
  const parts = [];
  if (reason) parts.push(...reason.split(/[，。；！？\n]/));
  if (pain) parts.push(...pain.split(/[，。；！？\n]/));
  return parts.map(s => s.trim()).filter(Boolean);
}
function buildBoilerplate(rows) {
  const cnt = {};
  for (const r of rows) {
    const v = firstSentence(get(r, '问题原因'));
    if (v.length >= 4) cnt[v] = (cnt[v] || 0) + 1;
  }
  const total = rows.length || 1;
  return new Set(Object.entries(cnt).filter(([, c]) => c / total >= 0.2).map(([v]) => v));
}
function rowText(r, boiler) {
  const reason = get(r, '问题原因');
  const pain = get(r, '需求痛点');
  let s = reason;
  if (!s || boiler.has(firstSentence(reason))) s = pain;
  if (!s) s = reason || pain || '';
  return cleanText(s);
}
function bigrams(s) {
  const res = [];
  for (let i = 0; i + 2 <= s.length; i++) {
    if (HAS_HAN.test(s.slice(i, i + 2))) res.push(s.slice(i, i + 2));
  }
  return res;
}
function jac(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function clusterRows(texts, thr) {
  const N = texts.length;
  const bg = texts.map(t => new Set(bigrams(t)));
  const parent = Array.from({ length: N }, (_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (find(i) === find(j)) continue;
      if (jac(bg[i], bg[j]) >= thr) parent[find(j)] = find(i);
    }
  }
  const groups = {};
  for (let i = 0; i < N; i++) { const r = find(i); if (!groups[r]) groups[r] = []; groups[r].push(i); }
  return Object.values(groups);
}
function commonPhrases(texts, maxLen) {
  const cnt = {};
  for (const t of texts) {
    for (let len = 2; len <= maxLen; len++) {
      for (let i = 0; i + len <= t.length; i++) {
        const q = t.slice(i, i + len);
        if (!HAS_HAN.test(q) || q.includes('\u0001')) continue;
        cnt[q] = (cnt[q] || 0) + 1;
      }
    }
  }
  return cnt;
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function buildBigramMap(texts) {
  const m = {};
  for (const t of texts) {
    for (let i = 0; i + 2 <= t.length; i++) {
      const bg = t.slice(i, i + 2);
      if (HAS_HAN.test(bg)) m[bg] = (m[bg] || 0) + 1;
    }
  }
  return m;
}
function buildName(seed, hitTexts, restBucketTexts, valid, isFragment, gBg) {
  // 简化版——完整逻辑在原文件 L810-970
  const parts = [seed];
  let best = seed;
  let bestCov = hitTexts.filter(t => t.includes(seed)).length;
  for (let len = seed.length + 1; len <= 12; len++) {
    for (let i = 0; i + len <= seed.length; i++) {
      // 尝试扩展
    }
  }
  return best;
}
function completeToken(q, hitTexts, bgMapArg) {
  let best = q;
  const bg = bgMapArg || buildBigramMap(hitTexts);
  for (let len = q.length + 1; len <= 12; len++) {
    let extended = false;
    for (const t of hitTexts) {
      const idx = t.indexOf(q);
      if (idx < 0) continue;
      if (idx + len <= t.length) {
        const ext = t.slice(idx, idx + len);
        if (HAS_HAN.test(ext) && !STOP.has(ext)) { best = ext; extended = true; break; }
      }
    }
    if (!extended) break;
  }
  return best;
}
function extendName(q, hitTexts, restBucketTexts, need) {
  let best = q;
  for (let len = q.length + 1; len <= 12; len++) {
    let extended = false;
    for (const t of hitTexts) {
      const idx = t.indexOf(q);
      if (idx < 0) continue;
      for (const [start, suffix] of [[0, t.slice(idx, idx + len)], [1, t.slice(Math.max(0, idx - (len - q.length)), idx + q.length)]]) {
        if (suffix.length === len && HAS_HAN.test(suffix) && !STOP.has(suffix) && hitTexts.filter(x => x.includes(suffix)).length >= need) {
          best = suffix; extended = true; break;
        }
      }
      if (extended) break;
    }
    if (!extended) break;
  }
  return best;
}
function finalizeName(q, hitTexts, restBucketTexts, gBg) {
  let best = q;
  const need = Math.ceil(hitTexts.length * 0.5);
  for (let len = q.length + 1; len <= 14; len++) {
    let extended = false;
    for (const t of hitTexts) {
      const idx = t.indexOf(q);
      if (idx < 0) continue;
      if (idx + len <= t.length) {
        const ext = t.slice(idx, idx + len);
        if (HAS_HAN.test(ext) && !STOP.has(ext) && hitTexts.filter(x => x.includes(ext)).length >= need && restBucketTexts.filter(x => x.includes(ext)).length === 0) {
          best = ext; extended = true; break;
        }
      }
    }
    if (!extended) break;
  }
  return best;
}
function autoSplit(otherRows, famRestRows, allRows, fam, prodName) {
  const texts = otherRows.map(r => rowText(r, buildBoilerplate(allRows)));
  const restTexts = famRestRows.map(r => rowText(r, buildBoilerplate(allRows)));
  const N = otherRows.length;
  const minDf = Math.max(2, Math.ceil(0.05 * N));
  const cands = [];
  for (let len = 2; len <= 10; len++) {
    const cnt = commonPhrases(texts, len);
    for (const [q, df] of Object.entries(cnt)) {
      if (df < minDf) continue;
      if (!HAS_HAN.test(q)) continue;
      if (FUNC_HEAD.test(q) || FUNC_TAIL.test(q)) continue;
      if (STOP.has(q)) continue;
      if (NOISE.some(n => q.includes(n))) continue;
      const gDf = commonPhrases([...texts, ...restTexts], len)[q] || 0;
      const conc = gDf > 0 ? df / gDf : 1;
      if (conc < 0.6) continue;
      const cands2 = texts.filter(t => t.includes(q));
      if (cands2.length < df) continue;
      const obj = completeToken(q, texts);
      cands.push({ phrase: q, obj, df, conc, rows: otherRows.filter((r, i) => texts[i].includes(q)) });
    }
  }
  cands.sort((a, b) => b.df * b.conc - a.df * a.conc);
  const chosen = [];
  const usedRows = new Set();
  for (const c of cands) {
    if (chosen.length >= 4) break;
    const newRows = c.rows.filter(r => !usedRows.has(r));
    if (newRows.length < minDf) continue;
    if (chosen.some(x => x.phrase.includes(c.phrase) || c.phrase.includes(x.phrase))) continue;
    chosen.push({ ...c, rows: newRows });
    newRows.forEach(r => usedRows.add(r));
  }
  const leftover = otherRows.filter(r => !usedRows.has(r));
  return { chosen, leftover, cands: cands.slice(0, 10), minDf, rej: { conc: cands.filter(c => c.conc < 0.6).length, frag: 0, noname: 0 } };
}

// =========================================================================
// 分类函数（从 validate-action-recs.cjs L1241-1540 原样移出）
// =========================================================================

function classify(rows, tax) {
  const famMap = new Map();
  let unclassified = 0;
  const rowStatus = [];
  for (const r of rows) {
    const reason = get(r, '问题原因');
    const pain = get(r, '需求痛点');
    let famHit = null, subHit = null, by = '-';
    for (const fam of tax.families) {
      const hitR = fam.re.test(reason);
      const hitP = !hitR && fam.re.test(pain);
      if (hitR || hitP) {
        famHit = fam; by = hitR ? '原因' : '痛点';
        for (const sub of fam.subs) {
          if (sub.re.test(reason) || sub.re.test(pain)) { subHit = sub; break; }
        }
        break;
      }
    }
    if (!famHit) { unclassified++; rowStatus.push({ status: 'unclassified', fam: null, sub: null }); continue; }
    const famKey = famHit.key || famHit.name;
    if (!famMap.has(famKey)) famMap.set(famKey, { fam: famHit, subs: new Map() });
    const fv = famMap.get(famKey);
    const boil = isBoilerplateReason(r);
    const subKey = subHit ? (subHit.key || subHit.name) : (boil ? '_unloc' : '_');
    if (!fv.subs.has(subKey)) fv.subs.set(subKey, { sub: subHit, rows: [] });
    fv.subs.get(subKey).rows.push(r);
    rowStatus.push({ status: subHit ? 'sub' : (boil ? 'unloc' : 'other'), fam: famHit.name, sub: subHit ? subHit.name : null });
  }
  return { famMap, unclassified, rowStatus, pending: 0, pendingRows: [], confThr: 0, stats: null, assistCandidates: [] };
}

// 分类法克隆（使闭环每轮从干净副本重建）
function cloneTax(tax) {
  return {
    name: tax.name, derived: !!tax.derived, curated: !!tax.curated,
    families: tax.families.map(f => ({
      key: f.key, name: f.name, re: new RegExp(f.re.source, f.re.flags), crossCut: f.crossCut,
      rec: f.rec || '', reExc: f.reExc ? new RegExp(f.reExc.source, f.reExc.flags) : null,
      phrases: (f.phrases || []).map(p => ({ re: new RegExp(p.re.source, p.re.flags) })),
      subs: (f.subs || []).map(s => ({
        key: s.key, name: s.name, re: new RegExp(s.re.source, s.re.flags),
        rec: s.rec || '', reExc: s.reExc ? new RegExp(s.reExc.source, s.reExc.flags) : null,
        phrases: (s.phrases || []).map(p => ({ re: new RegExp(p.re.source, p.re.flags) })),
      })),
    })),
  };
}

// 派生草稿分类法（新产品无 curated 时）
const PROBLEM_CUE_GLOBAL = /不支持|无法|不足|受限|超限|未留存|未释放|未提供|未达预期|缺失|无(入口|功能|自助)|需人工|人工审批|计划部审批|不透明|失败|异常|拒绝|冻结|不提供|不可见|限制|冷静期|保留期|瓶颈|不符|波动|不稳定|卡顿|不可行|未开放|无自助/;

function deriveDraftTax(product, rows) {
  const S = '';
  const texts = rows.map(r => [get(r, '问题原因'), get(r, '需求痛点')].filter(Boolean).join(S));
  const cand = new Map();
  const minDf = Math.max(2, Math.ceil(0.03 * rows.length));
  for (const t of texts) {
    for (let len = 3; len <= 10; len++) {
      for (let i = 0; i + len <= t.length; i++) {
        const q = t.slice(i, i + len);
        if (q.indexOf(S) >= 0) continue;
        if (!/^[一-龥]/.test(q) || !PROBLEM_CUE_GLOBAL.test(q)) continue;
        const nonCue = q.replace(PROBLEM_CUE_GLOBAL, '');
        if ((nonCue.match(/[一-龥]/g) || []).length < 2) continue;
        if (/[的了和与或在是为无有未不此于对至向等中时后前内外上下该其之]$/.test(q)) continue;
        cand.set(q, (cand.get(q) || 0) + 1);
      }
    }
  }
  const ranked = [...cand.entries()].filter(([, c]) => c >= minDf).sort((a, b) => b[1] - a[1]);
  const chosen = [];
  for (const [q, c] of ranked) {
    if (chosen.length >= 10) break;
    if (chosen.some(([q2]) => q2.includes(q) || q.includes(q2))) continue;
    chosen.push([q, c]);
  }
  const families = chosen.map(([q], idx) => ({ key: 'draft_' + idx, name: q, re: new RegExp(q), subs: [] }));
  if (!families.length) families.push({ key: 'draft_other', name: '待归类(草稿)', re: /.*/, subs: [] });
  return { name: `${product}·派生草稿`, derived: true, families };
}

// =========================================================================
// 区分度加权分类（scoredMode）——内联实现，不再 require 原文件
// =========================================================================

const RE_META = /[\\^$.*+?()[\]{}|]/;
const FIELD_W = { voice: 1.0, pain: 0.7, reason: 0.7 };

function seedMatchers(re) {
  const out = [], seen = new Set();
  for (const raw of String(re.source).split('|')) {
    const w = raw.trim();
    if (!w || w.length < 2 || seen.has(w)) continue;
    seen.add(w);
    if (!RE_META.test(w)) { out.push({ w, test: t => t.indexOf(w) >= 0 }); }
    else {
      let rx; try { rx = new RegExp(w); } catch { continue; }
      out.push({ w, test: t => rx.test(t) });
    }
  }
  return out;
}
function famSeedMatchers(fam) {
  const out = [], seen = new Set();
  for (const m of [...seedMatchers(fam.re), ...fam.subs.flatMap(s => seedMatchers(s.re))]) {
    if (seen.has(m.w)) continue;
    seen.add(m.w); out.push(m);
  }
  return out;
}
function textForMatch(r) {
  const v = voiceOf(r);
  return `${v ? v.v : ''}\u0001${get(r, '需求痛点')}\u0001${cleanReason(get(r, '问题原因'))}`;
}

function learnWordWeights(rows, tax) {
  const fams = tax.families, N = Math.max(1, rows.length);
  const texts = rows.map(textForMatch);
  const famWords = new Map(), wordFams = new Map();
  for (const f of fams) {
    const ws = famSeedMatchers(f);
    famWords.set(f.key, ws);
    for (const m of ws) {
      if (!wordFams.has(m.w)) wordFams.set(m.w, new Set());
      wordFams.get(m.w).add(f.key);
    }
  }
  const excl = new Map();
  let ambiguous = 0, none = 0;
  for (let i = 0; i < rows.length; i++) {
    const t = texts[i]; const hits = [];
    for (const f of fams) {
      for (const m of famWords.get(f.key)) if (m.test(t)) { hits.push(f.key); break; }
    }
    if (hits.length === 1) { if (!excl.has(hits[0])) excl.set(hits[0], []); excl.get(hits[0]).push(i); }
    else if (hits.length > 1) ambiguous++; else none++;
  }
  const W = new Map(), generic = [];
  const matcherOf = new Map();
  for (const ms of famWords.values()) for (const m of ms) if (!matcherOf.has(m.w)) matcherOf.set(m.w, m);
  for (const [w, fset] of wordFams) {
    const mt = matcherOf.get(w); if (!mt) continue;
    let dfAll = 0;
    for (let i = 0; i < rows.length; i++) if (mt.test(texts[i])) dfAll++;
    let inMine = 0, inOthers = 0;
    for (const [fk, idxs] of excl) {
      let c = 0;
      for (const i of idxs) if (mt.test(texts[i])) c++;
      if (fset.has(fk)) inMine += c; else inOthers += c;
    }
    const idf = Math.log(N / (1 + dfAll));
    const spec = inMine / (1 + inOthers);
    const spread = fset.size;
    const penalty = spread >= 3 ? 0.3 : (spread >= 2 ? 0.6 : 1.0);
    W.set(w, { w: Math.max(0.01, idf * spec * penalty), dfAll, inMine, inOthers, spread, penalty });
    if (spread >= 3) generic.push({ w, dfAll, spread, penalty });
  }
  return { W, famWords, excl, ambiguous, none, generic: generic.sort((a, b) => b.dfAll - a.dfAll), texts };
}

const NEG_CUE = /缺乏|无法|不能|未能|未明确|不明确|不清楚|没有|难以|缺失|不支持|不足|不畅|异常|失败|错误|卡顿|超时|不一致|未生效|不透明/;

function scoreText(text, matchers, W, fieldW) {
  if (!text) return { s: 0, hitN: 0 };
  const parts = text.split(/[，。；：、,.;:]/).filter(p => p.trim().length >= 2);
  if (!parts.length) return { s: 0, hitN: 0 };
  let s = 0;
  const counted = new Set();
  for (const p of parts) {
    const boost = NEG_CUE.test(p) ? 1.5 : 1.0;
    for (const m of matchers) {
      if (counted.has(m.w)) continue;
      const rec = W.get(m.w); if (!rec) continue;
      if (m.test(p)) { s += rec.w * fieldW * boost; counted.add(m.w); }
    }
  }
  return { s, hitN: counted.size };
}

function scorePhrases(text, phrases, W, fieldW) {
  if (!text || !phrases || !phrases.length) return 0;
  const parts = text.split(/[，。；：、,.;:]/).filter(p => p.trim().length >= 2);
  if (!parts.length) return 0;
  let maxWordW = 0;
  for (const rec of W.values()) if (rec.w > maxWordW) maxWordW = rec.w;
  const phraseBase = Math.max(0.5, maxWordW * 2.0);
  let s = 0;
  for (const p of parts) {
    for (const ph of phrases) {
      if (ph.re.test(p)) { s += phraseBase * fieldW; break; }
    }
  }
  return s;
}

function scoreFamilies(i, tax, LW) {
  const [voice, pain, reason] = LW.texts[i].split('\u0001');
  const fullText = (voice || '') + '\u0001' + (pain || '') + '\u0001' + (reason || '');
  const out = [];
  for (const f of tax.families) {
    const ms = LW.famWords.get(f.key);
    const a = scoreText(voice || '', ms, LW.W, FIELD_W.voice);
    const b = scoreText(pain, ms, LW.W, FIELD_W.pain);
    const c = scoreText(reason, ms, LW.W, FIELD_W.reason);
    let raw = a.s + b.s + c.s;
    if (f.phrases && f.phrases.length) {
      raw += scorePhrases(voice || '', f.phrases, LW.W, FIELD_W.voice);
      raw += scorePhrases(pain, f.phrases, LW.W, FIELD_W.pain);
      raw += scorePhrases(reason, f.phrases, LW.W, FIELD_W.reason);
    }
    const exc = f.reExc && f.reExc.test(fullText);
    out.push({ fam: f, s: exc ? 0 : raw, hitN: a.hitN + b.hitN + c.hitN, byReason: a.hitN === 0 && b.hitN === 0 && c.hitN > 0, exc });
  }
  out.sort((a, b) => b.s - a.s);
  return out;
}

function scoreSubs(i, fam, LW) {
  const [voice, pain, reason] = LW.texts[i].split('\u0001');
  const fullText = (voice || '') + '\u0001' + (pain || '') + '\u0001' + (reason || '');
  const out = [];
  for (const s of fam.subs) {
    const ms = seedMatchers(s.re);
    let raw = scoreText(voice || '', ms, LW.W, FIELD_W.voice).s + scoreText(pain, ms, LW.W, FIELD_W.pain).s + scoreText(reason, ms, LW.W, FIELD_W.reason).s;
    if (s.phrases && s.phrases.length) {
      raw += scorePhrases(voice || '', s.phrases, LW.W, FIELD_W.voice);
      raw += scorePhrases(pain, s.phrases, LW.W, FIELD_W.pain);
      raw += scorePhrases(reason, s.phrases, LW.W, FIELD_W.reason);
    }
    const exc = s.reExc && s.reExc.test(fullText);
    out.push({ sub: s, v: exc ? 0 : raw, exc });
  }
  out.sort((a, b) => b.v - a.v);
  return out;
}

function adaptiveConfThreshold(confs, q = 0.15) {
  if (!confs.length) return 0.15;
  const s = [...confs].sort((a, b) => a - b);
  return Math.max(0.08, Math.min(0.30, s[Math.floor(q * (s.length - 1))]));
}

function classifyScored(rows, tax) {
  const LW = learnWordWeights(rows, tax);
  const scored = [];
  for (let i = 0; i < rows.length; i++) {
    const famSc = scoreFamilies(i, tax, LW);
    const best = { fam: famSc[0].fam, sub: null, s: famSc[0].s };
    const secondS = famSc[1] ? famSc[1].s : 0;
    const hitN = famSc[0].hitN || 0;
    const srcPenalty = famSc[0].byReason ? 0.85 : 1.0;
    const confRaw = best.s > 0 ? (best.s - secondS) / best.s : 0;
    const conf = confRaw * srcPenalty;
    scored.push({ i, best, conf, confRaw, hitN, byReason: !!famSc[0].byReason, famSc });
  }
  const confs = scored.filter(x => x.best.s > 0).map(x => x.conf);
  const confThr = adaptiveConfThreshold(confs, 0.15);
  const sVals = scored.filter(x => x.best.s > 0).map(x => x.best.s).sort((a, b) => a - b);
  const sP20 = sVals.length ? sVals[Math.floor(0.20 * (sVals.length - 1))] : 0;
  const famMap = new Map();
  let unclassified = 0, pending = 0;
  const pendingRows = [];
  const rowStatus = new Array(rows.length);
  const assistCandidates = [];
  for (let xi = 0; xi < scored.length; xi++) {
    const x = scored[xi];
    if (x.best.s <= 0) { unclassified++; rowStatus[x.i] = { status: 'unclassified' }; continue; }
    const weak = !x.byReason && (x.hitN || 0) < 2 && x.best.s < sP20;
    if (weak || x.conf < confThr) { pending++; pendingRows.push(rows[x.i]); rowStatus[x.i] = { status: 'pending', fam: x.best.fam.key }; continue; }
    const famHits = x.famSc.filter(s => s.s > 0).length;
    if (famHits >= 3 || (famHits >= 2 && x.conf < 0.4)) {
      assistCandidates.push({ i: x.i, ticketId: get(rows[x.i], '工单号'), famScores: x.famSc.slice(0, 5), best: x.best, conf: x.conf });
    }
    const r = rows[x.i], fam = x.best.fam;
    const ss = scoreSubs(x.i, fam, LW);
    const subHit = ss.length && ss[0].v > 0 ? ss[0].sub : null;
    if (!famMap.has(fam.key)) famMap.set(fam.key, { fam, subs: new Map() });
    const k = subHit ? subHit.key : (isBoilerplateReason(r) ? '_unloc' : '_');
    const m = famMap.get(fam.key).subs;
    if (!m.has(k)) m.set(k, { sub: subHit, rows: [] });
    m.get(k).rows.push(r);
    rowStatus[x.i] = { status: 'classified', fam: fam.key, sub: subHit ? subHit.key : null };
  }
  return { famMap, unclassified, pending, pendingRows, confThr, LW, rowStatus, assistCandidates,
           stats: { ambiguous: LW.ambiguous, none: LW.none, generic: LW.generic.length } };
}

// =========================================================================
// mkItem + analyze + thresholds（从 validate-action-recs.cjs L1541-1646 原样移出）
// =========================================================================

function mkItem(famName, subName, rs, autoInfo, crossCut) {
  const n = rs.length;
  // 动态推断本月/上月：取 rs 中出现最多的两个月份，降序为 cur/prev
  const months = [...new Set(rs.map(monthOf).filter(m => m && m !== '?'))].sort();
  const curMonth = months[months.length - 1] || '';
  const prevMonth = months[months.length - 2] || '';
  const cur = rs.filter(r => monthOf(r) === curMonth).length;
  const prev = rs.filter(r => monthOf(r) === prevMonth).length;
  const c = rs.filter(r => srcOf(r) === '投诉').length;
  const q = rs.filter(r => srcOf(r) === '咨询').length;
  const u = rs.filter(r => get(r, '是否加急') === '加急').length;
  const cr = n ? c / n * 100 : 0;
  let mom = null;
  const dAbs = cur - prev;
  if (prev > 0) mom = (cur - prev) / prev * 100;
  return {
    fam: famName, sub: subName, n, prev, cur, c, q, u, cr, mom, dAbs, crossCut: !!crossCut,
    ticketIds: rs.map(r => get(r, '工单号')).filter(Boolean),
    voice: rs.map(voiceOf).find(x => x),
    pain: topSentence(rs, '需求痛点'),
    root: topSentence(rs, '问题原因'),
    mat: topK(rs, '产品技术优化', 3),
    auto: autoInfo || null,
  };
}

function analyze(rows, tax, T, B, thr, prodName) {
  const scoredMode = process.env.MATCH_MODE !== 'first';
  const cls = scoredMode ? classifyScored(rows, tax) : classify(rows, tax);
  const { famMap, unclassified } = cls;
  const pending = cls.pending || 0, pendingRows = cls.pendingRows || [], confThr = cls.confThr || 0;
  const matchStats = cls.stats || null;
  const otherThreshold = Math.max(4, Math.ceil(0.05 * T));
  const items = [];
  const proposals = [];
  const splitLog = [];
  let unlocated = 0;

  for (const [, fv] of famMap) {
    const famRowsArr = [];
    for (const [, g] of fv.subs) famRowsArr.push(...g.rows);
    for (const [k, g] of fv.subs) {
      if (k === '_unloc') { items.push(mkItem(fv.fam.name, '（未定位·无根因模板）', g.rows, null, fv.fam.crossCut)); unlocated += g.rows.length; continue; }
      if (k !== '_') { items.push(mkItem(fv.fam.name, g.sub.name, g.rows, null, fv.fam.crossCut)); continue; }
      const N = g.rows.length;
      const famN = famRowsArr.length;
      const byShare = N >= 4 && N / Math.max(1, famN) >= 0.4;
      if (!(N >= otherThreshold || byShare)) {
        items.push(mkItem(fv.fam.name, '（其他/通用）', g.rows, null, fv.fam.crossCut)); continue;
      }
      if (tax.curated) { items.push(mkItem(fv.fam.name, '（其他/通用）', g.rows, null, fv.fam.crossCut)); continue; }
      const inBucket = new Set(g.rows);
      const rest = famRowsArr.filter(r => !inBucket.has(r));
      const sp = autoSplit(g.rows, rest, rows, fv.fam, prodName);
      splitLog.push({
        fam: fv.fam.name, N, minDf: sp.minDf,
        split: sp.chosen.map(c => ({ phrase: c.phrase, obj: c.obj, df: c.df, conc: c.conc })),
        leftover: sp.leftover.length,
        rej: sp.rej,
        topCands: sp.cands.slice(0, 6).map(c => `${c.p}(df${c.df})`),
      });
      for (const c of sp.chosen) {
        const info = { phrase: c.phrase, df: c.df, conc: c.conc, N };
        items.push(mkItem(fv.fam.name, c.phrase, c.rows, info, fv.fam.crossCut));
        proposals.push({ fam: fv.fam.name, sub: c.phrase, re: escapeRe(c.obj), df: c.df, conc: c.conc, bucketN: N });
      }
      if (sp.leftover.length) items.push(mkItem(fv.fam.name, '（其他/通用）', sp.leftover, null, fv.fam.crossCut));
    }
  }

  for (const it of items) {
    if (it.sub === '（未定位·无根因模板）') { it.tier = 'tail'; it.highHarm = false; continue; }
    if (it.crossCut) { it.tier = 'cross'; it.highHarm = false; continue; }
    let tier = 'tail';
    if (it.n >= thr.S) tier = 'structural';
    else if (it.mom !== null && Math.abs(it.mom) >= 50 && Math.abs(it.dAbs) >= thr.delta) tier = 'change';
    if (tier !== 'structural' && tier !== 'change' && it.cr >= thr.H && it.n >= 3) tier = 'sharp';
    if (tier === 'tail' && it.n >= thr.L) tier = 'iteration';
    it.tier = tier;
    it.highHarm = it.cr >= thr.H;
  }
  if (tax.curated) {
    const famRec = new Map(tax.families.map(f => [f.name, f.rec || '']));
    const subRec = new Map();
    for (const f of tax.families) for (const s of (f.subs || [])) subRec.set(f.name + '/' + s.name, s.rec || '');
    for (const it of items) it.recText = subRec.get(it.fam + '/' + it.sub) || famRec.get(it.fam) || '';
  }
  const diagKw = /诊断|可视化|自助|定位|排查|根因|trace|mtr|抓包/;
  const diagN = rows.filter(r => diagKw.test(get(r, '需求痛点')) || diagKw.test(get(r, '问题原因'))).length;
  return { items, unclassified, diagN, proposals, splitLog, otherThreshold, unlocated,
           pending, pendingRows, confThr, matchStats, scoredMode, rowStatus: cls.rowStatus,
           assistCandidates: cls.assistCandidates || [] };
}

function thresholds(T, B) {
  const H = Math.min(100, Math.max(17, Math.round(1.5 * B * 10) / 10));
  const S = Math.max(10, Math.round(0.10 * T));
  const L = Math.max(3, Math.min(10, Math.round(0.01 * T)));
  const delta = Math.min(12, Math.max(3, Math.round(0.05 * T)));
  return { H, S, L, delta };
}

const TIER_LABEL = { structural: '长期结构性', change: '本月异动', sharp: '小而锐', iteration: '常规迭代', tail: '长尾' };

// =========================================================================
// runEngine：引擎入口（替代 runPipeline，接收 records 而非全局 d）
// =========================================================================

function runEngine(records, opts = {}) {
  opts = opts || {};
  // 加载 curated 分类法（首次调用时加载）
  loadCuratedAll(opts.scriptDir || path.resolve(__dirname, '..'));
  const TM = opts.taxMap || CAUSE_TAX_MAP;
  const SCOPE = opts.productScope;
  const prodsAll = [...new Set(records.map(r => get(r, '产品名称').replace(/\s/g, '')))].filter(Boolean);
  const prods = SCOPE === '*' ? prodsAll
    : (Array.isArray(SCOPE) ? SCOPE
      : (typeof SCOPE === 'string' ? SCOPE.split(',').map(s => s.trim()).filter(Boolean)
        : Object.keys(CAUSE_TAX_MAP).filter(p => prodsAll.includes(p))));

  const OV = opts.overrides || (opts.disableOverrides ? {} : loadOverrides());
  const summary = [];
  const allProposals = [];

  for (const p of prods) {
    const rows = records.filter(r => get(r, '产品名称').replace(/\s/g, '') === p);
    if (!rows.length) continue;
    const T = rows.length;
    const c = rows.filter(r => srcOf(r) === '投诉').length;
    const B = +(c / T * 100).toFixed(1);
    const thr = thresholds(T, B);
    let tax, derived = false;
    if (TM[p]) { tax = TM[p]; }
    else if (TAX[p]) { tax = TAX[p]; }
    else { tax = deriveDraftTax(p, rows); derived = true; }
    if (!derived && OV[p]) { tax = cloneTax(tax); applyOverrides(tax, OV[p]); }
    const res = analyze(rows, tax, T, B, thr, p);
    for (const pr of res.proposals) allProposals.push({ product: p, ...pr });
    const tierCount = {};
    for (const i of res.items) tierCount[i.tier] = (tierCount[i.tier] || 0) + 1;
    summary.push({
      p, T, B, thr, unclassified: res.unclassified, diagN: res.diagN, tierCount,
      nSub: res.items.length, splitLog: res.splitLog, otherThreshold: res.otherThreshold,
      items: res.items, nFam: tax.families.length, unlocated: res.unlocated,
      taxUsed: tax, derived,
      pending: res.pending, pendingRows: res.pendingRows, confThr: res.confThr,
      matchStats: res.matchStats, scoredMode: res.scoredMode, rowStatus: res.rowStatus,
      assistCandidates: res.assistCandidates || [],
    });
  }
  return { summary, allProposals };
}

// =========================================================================
// runGate：门禁（从 validate-action-recs.cjs L2147-2207 适配，接收 engineResult）
// =========================================================================

function runGate(engineResult, opts = {}) {
  opts = opts || {};
  const { summary } = engineResult;
  const G = [];
  const push = (name, ok, detail, level) => G.push({ name, ok, detail, level: level || (ok ? 'PASS' : 'FAIL') });

  // 1) 未归类率
  const MAX_UNC = +(opts.maxUnclassified || 5);
  const MAX_PEND = +(opts.maxPending || 20);
  for (const s of summary) {
    const rate = s.unclassified / s.T * 100;
    push(`未归类率·${s.p}`, rate < MAX_UNC, `${rate.toFixed(1)}%（阈值 <${MAX_UNC}%）${s.derived ? ' [派生草稿·待确认]' : ''}`);
  }
  // 2) 待确认率
  for (const s of summary) {
    if (s.pending == null) continue;
    const rate = s.pending / s.T * 100;
    push(`待确认率·${s.p}`, rate < MAX_PEND, `${rate.toFixed(1)}%（阈值 <${MAX_PEND}%）${s.derived ? ' [派生草稿·待确认]' : ''}`);
  }
  // 3) 小而锐最小样本
  for (const s of summary) {
    const bad = (s.items || []).filter(i => i.tier === 'sharp' && i.n < 3);
    push(`小而锐样本·${s.p}`, bad.length === 0,
      bad.length ? `${bad.length} 项 n<3：${bad.slice(0, 3).map(i => `${i.sub}(${i.n})`).join('、')}` : '均满足 n≥3');
  }
  // 4) 横切项单列
  const TIERS5 = ['structural', 'change', 'sharp', 'iteration', 'tail'];
  for (const s of summary) {
    const bad = (s.items || []).filter(i => i.crossCut && TIERS5.includes(i.tier));
    push(`横切项单列·${s.p}`, bad.length === 0, bad.length ? `${bad.length} 个横切项混入 5 层` : '横切项已单列');
  }
  // 5) 出处标注检查：items 中有 pain/root 标注的占比 ≥ 80% 才 PASS
  for (const s of summary) {
    const items = s.items || [];
    const withAnnotation = items.filter(i => i.pain || i.root);
    const rate = items.length ? withAnnotation.length / items.length * 100 : 100;
    push(`出处标注·${s.p}`, rate >= 80, `${rate.toFixed(0)}%（阈值 ≥80%）${rate < 80 ? `：${items.length - withAnnotation.length} 项缺标注` : ''}`);
  }

  const fails = G.filter(g => g.level === 'FAIL');
  const warns = G.filter(g => g.level === 'WARN');
  const passed = fails.length === 0;
  return { G, fails, warns, passed, accuracyByProduct: {} };
}

// =========================================================================
// runFixer：修复器（简化版——完整逻辑在 fix-classification.cjs 中）
// =========================================================================

function runFixer(gateReport, engineResult, taxMap) {
  const overrides = { families: [] };
  const changelog = [];
  let applied = false;

  for (const f of (gateReport.fails || [])) {
    // 小而锐样本不足 → 降级 sharp→tail（n<3 不可信）
    if (f.name.startsWith('小而锐样本')) {
      const prodName = f.name.split('·')[1]?.trim();
      const s = engineResult.summary.find(s => s.p === prodName);
      if (s) {
        for (const it of s.items) {
          if (it.tier === 'sharp' && it.n < 3) {
            it.tier = 'tail';
            changelog.push({ type: 'demote', check: f.name, detail: `${it.fam}/${it.sub} sharp→tail (n=${it.n})` });
            applied = true;
          }
        }
      }
      continue;
    }
    // 横切项混入 → 改 tier 为 'cross'
    if (f.name.startsWith('横切项单列')) {
      const prodName = f.name.split('·')[1]?.trim();
      const s = engineResult.summary.find(s => s.p === prodName);
      if (s) {
        const TIERS5 = ['structural', 'change', 'sharp', 'iteration', 'tail'];
        for (const it of s.items) {
          if (it.crossCut && TIERS5.includes(it.tier)) {
            const oldTier = it.tier;
            it.tier = 'cross';
            changelog.push({ type: 'recross', check: f.name, detail: `${it.fam}/${it.sub} ${oldTier}→cross` });
            applied = true;
          }
        }
      }
      continue;
    }
    // 不可自动修的项（未归类率高、待确认率高、出处标注缺失）→ 记录升级人工
    changelog.push({
      type: 'escalate',
      check: f.name,
      detail: f.detail,
      action: '需人工补正则或子议题',
    });
  }

  return { overrides, changelog, applied };
}

// =========================================================================
// runLoop：有界闭环
// =========================================================================

function runLoop(records, opts = {}) {
  const maxRounds = opts.maxRounds || 5;
  loadCuratedAll(opts.scriptDir || path.resolve(__dirname, '..'));
  let overrides = opts.initialOverrides || {};
  let result, gateReport;
  const loopLog = [];

  let actualRounds = 0;
  for (let round = 1; round <= maxRounds; round++) {
    actualRounds = round;
    result = runEngine(records, { ...opts, overrides });
    gateReport = runGate(result, opts);

    if (gateReport.passed) {
      loopLog.push(`[Round ${round}] PASS (${gateReport.G.length - gateReport.fails.length}/${gateReport.G.length})`);
      return { result, gateReport, finalOverrides: overrides, rounds: round, escalated: false, loopLog };
    }

    loopLog.push(`[Round ${round}] FAIL (${gateReport.fails.length} 项)`);

    const fixResult = runFixer(gateReport, result, opts.taxMap || CAUSE_TAX_MAP);
    if (!fixResult.applied) {
      loopLog.push(`[Round ${round}] Fixer 无可修项，升级人工`);
      break;
    }

    // Fixer 做了 in-place tier 修改，立即重验 Gate（不重跑 engine）
    gateReport = runGate(result, opts);
    loopLog.push(`[Round ${round}] Fixer 应用 ${fixResult.changelog.length} 项变更，重验`);

    if (gateReport.passed) {
      loopLog.push(`[Round ${round}] PASS after fix`);
      return { result, gateReport, finalOverrides: overrides, rounds: round, escalated: false, loopLog };
    }

    // Fixer 修改不够，检查是否有 overrides 增量可叠加到下一轮
    if (fixResult.overrides && fixResult.overrides.families && fixResult.overrides.families.length) {
      overrides = mergeOverrides(overrides, fixResult.overrides);
    } else {
      // 无 overrides 可叠加，in-place 修改又不够 → 升级人工
      loopLog.push(`[Round ${round}] 无 overrides 可叠加，升级人工`);
      break;
    }
  }

  return { result, gateReport, finalOverrides: overrides, rounds: actualRounds, escalated: true, loopLog };
}

function mergeOverrides(base, patch) {
  if (!patch || !patch.families) return base;
  const merged = JSON.parse(JSON.stringify(base));
  if (!merged.families) merged.families = [];
  for (const famOv of patch.families) {
    const existing = merged.families.find(f => f.key === famOv.key || f.name === famOv.name);
    if (existing) {
      if (famOv.re != null) existing.re = famOv.re;
      if (Array.isArray(famOv.addSubs)) {
        if (!existing.addSubs) existing.addSubs = [];
        existing.addSubs.push(...famOv.addSubs);
      }
    } else {
      merged.families.push(famOv);
    }
  }
  return merged;
}

// =========================================================================
// 导出
// =========================================================================

module.exports = {
  // 引擎核心
  runEngine,
  runGate,
  runFixer,
  runLoop,
  mergeOverrides,
  // 分类法
  TAX,
  CAUSE_TAX_MAP,
  loadCuratedAll,
  loadOverrides,
  applyOverrides,
  cloneTax,
  deriveDraftTax,
  // 分类函数
  classify,
  classifyScored,
  analyze,
  mkItem,
  thresholds,
  TIER_LABEL,
  // 辅助函数
  get,
  srcOf,
  monthOf,
  firstSentence,
  cleanFlowNoise,
  voiceOf,
  cleanReason,
  isBoilerplateReason,
  topSentence,
  topK,
  // 自动细分
  autoSplit,
  escapeRe,
};
