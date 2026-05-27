import { extractCustomerQuote } from './extract.js'

/** 精确停用（礼貌用语、工单字段名、流程套话等） */
const STOP_EXACT = new Set([
  '谢谢', '感谢', '您好', '你好', '请问', '不好意思', '辛苦', '麻烦', '好的', '明白',
  '收到', '确认', '跟进', '协助', '请求', '咨询', '联系', '反馈', '处理', '回复',
  '协助请求', '请求节点', '服务类型', '问题子类', '客户标签', '联系时间', '问题原因',
  '投诉原因', '受理内容', '处理意见', '归档意见', '追加信息', '追加内容', '追加时间',
  '详细内容', '客户需求',
  '工单标题', '工单流水号', '流水号', '受理时间', '归档时间', '创建时间', '受理渠道',
  '如有问题', '随时咨询', '随时联系', '其他问题', '问题描述', '客户问题', '客户反馈',
  '移动云', '云平台', '用户', '客户', '工单', '问题', '情况', '进行', '已经', '目前',
  '可以', '需要', '希望', '因为', '所以', '但是', '如果', '这个', '那个', '什么', '怎么',
  '是否', '无法', '不能', '没有', '还是', '以及', '或者', '并且', '通过', '关于',
  'uuid', 'null', 'true', 'false', 'http', 'https', 'www', 'com', 'cn', 'api', 'json',
  'html', 'index', 'ticket', 'id', 'key', 'type', 'name', 'code', 'status', 'error',
  'info', 'data', 'test', 'admin', 'user', 'prod', 'dev', 'src', 'dst', 'ip', 'dns',
  'vpc', 'ecs', 'eip', 'nat', 'ssl', 'tcp', 'udp', 'ssh', 'rdp', 'ping', 'ntp',
  'mbps', 'gbps', 'kbps', 'bps', 'Mbps', 'Gbps', 'Kbps',
  '联系电话', '联系手机', '手机号', '手机号码', '电话', '邮箱', '邮件', '联系人',
  '预处理', '归档', '核实', '回访', '协同', '催单', '流转', '内部', '系统侧',
  '平台侧', '接口', '日志', '截图', '附件', '上传', '下载', '提交', '填写',
  '单位', '部门', '职务', '姓名', '地址', '省份', '城市', '区县', '邮编',
  '资源池', '实例', '订单', '工单号', '流水号', '编号', '编码', '规格',
  '必填', '选填', '默认', '正常', '异常', '成功', '失败', '提示', '说明',
  '测试', '测试环境', '客户侧', '用户侧', '厂商侧', '我方', '贵方',
  'ipv', 'ipv4', 'ipv6', 'IPv4', 'IPv6', 'IP地址',
  '客服老师', '后台技术老师', '后台技术', '技术老师', '帮忙删除资源', '帮忙删除',
  '将工单转给', '转给后台', '麻烦客服', '麻烦客服老师',
  '麻烦客服老师将工单转给后台技术老师帮忙删除资源',
  '不涉及', '云技术专家核实', '云技术专家', '专家核实', '处理人', '协办', '协办人',
  '转协办', '派单', '认领', '认领人', '挂起', '关单', '结单', '回单', '复核',
  '稽核', '转派', '二线', '三线', '升级处理', '当前处理', '处理班组', '处理组',
  '技术专家', '专家侧', '运维核实', '后台核实', '内部核实', '协办核实',
  '不涉及问题', '非工单', '工单处理人', '主责', '责任人',
])

/** 子串命中即视为无效（客服转单、删资源等套话） */
const STOP_SUBSTRINGS = [
  '麻烦客服',
  '麻烦您客服',
  '麻烦你客服',
  '将工单转给',
  '工单转给',
  '转给后台',
  '转交后台',
  '转至后台',
  '后台技术老师',
  '后台技术',
  '客服老师',
  '帮忙删除资源',
  '帮忙删除',
  '帮忙释放资源',
  '帮忙清理资源',
  '转给后台技术',
  '不涉及',
  '云技术专家',
  '专家核实',
  '处理人',
  '协办',
  '协办处理',
  '转协办',
  '派单给',
  '认领工单',
  '升级至专家',
  '专家回单',
  '后台核实',
  '运维核实',
  '内部协查',
]

/** 与 STOP_EXACT 合并的 legacy 停用词 */
const STOP_LEGACY = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '上', '也', '很', '到',
  '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那',
])

const STOP_ALL = new Set([...STOP_EXACT, ...STOP_LEGACY])

/** @type {RegExp[]} */
const STOP_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{32}$/i,
  /^[a-f0-9]{8,}$/i,
  /^\d+$/,
  /^v\d+$/i,
  /^[a-z]{1,2}$/i,
  /^[a-z]*\d+[a-z\d]*$/i,
  /^(mbps|gbps|kbps|bps)$/i,
  /^ipv\d*$/i,
  /^ip$/i,
  /^(测试|客户侧|用户侧|厂商侧)$/,
  /^联系(电话|手机|方式|人|邮箱)?$/,
  /^(预|后)处理$/,
  /电话$/,
  /号码$/,
  /^不涉及/,
  /协办/,
  /处理人/,
  /专家核实/,
  /云技术专家/,
  /^(挂起|关单|结单|回单|复核|稽核|派单|转派)$/,
]

/** 从正文中剔除工单模板字段行，避免把标签名当词频 */
const BOILERPLATE_LINE_RE =
  /^(工单|流水号|受理|归档|追加时间|追加内容|追加信息|请求节点|服务类型|问题子类|客户标签|联系时间|投诉原因|处理意见|解决方案|根因|资源池|产品规格|版本|处理人|协办人|协办|认领人|派单人|当前处理人)[：:]/i

/** 客服转单、请后台删资源等运营套话（整句或片段） */
const CS_HANDOFF_LINE_RE =
  /麻烦[您你]?客服|将工单转给|转给后台|转交后台|后台技术老师|帮忙删除资源|帮忙释放资源|帮忙清理资源/

/** 从段落中剔除客服转单类套话 */
const CS_HANDOFF_SNIPPET_RE =
  /麻烦[您你]?客服[^。；\n]{0,160}?(转给|转交|转至)[^。；\n]{0,160}?(后台|技术)[^。；\n]{0,200}?(帮忙)?(删除|释放|清理|退订)?(资源|实例|数据)?/g

/**
 * @param {string} line
 */
function isBoilerplateLine(line) {
  if (!line?.trim()) return true
  if (BOILERPLATE_LINE_RE.test(line)) return true
  if (CS_HANDOFF_LINE_RE.test(line)) return true
  return false
}

/**
 * @param {string} token
 */
export function isMeaninglessKeyword(token) {
  const t = (token || '').trim()
  if (!t) return true
  const lower = t.toLowerCase()
  if (STOP_ALL.has(t) || STOP_ALL.has(lower)) return true
  if (STOP_SUBSTRINGS.some((s) => t.includes(s))) return true
  if (t.length < 2) return true
  if (STOP_PATTERNS.some((re) => re.test(t) || re.test(lower))) return true
  if (/^[\d\s\-_.:]+$/.test(t)) return true
  if (CS_HANDOFF_LINE_RE.test(t)) return true
  return false
}

/**
 * @param {string} text
 */
export function stripTicketBoilerplate(text) {
  if (!text?.trim()) return ''
  return text
    .replace(/【处理意见】[\s\S]*/g, '')
    .replace(CS_HANDOFF_SNIPPET_RE, ' ')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !isBoilerplateLine(line))
    .join('\n')
    .trim()
}

/**
 * 用于高频词统计的客户侧文本（不含处理意见、请求节点等）
 * @param {import('./types.js').FeedbackRecord} fb
 */
export function textForKeywordExtraction(fb) {
  const parts = [fb.problemSummary, fb.customerQuote].filter((s) => s?.trim())
  if (parts.length) {
    return stripTicketBoilerplate(parts.join('\n'))
  }
  const raw = fb.rawText || fb.handlingText || ''
  const quote = extractCustomerQuote(raw)
  if (quote?.trim()) {
    return stripTicketBoilerplate(quote)
  }
  return stripTicketBoilerplate(raw)
}

const TOKEN_RE = /[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}/g

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeForKeywords(text) {
  if (!text?.trim()) return []
  return (text.match(TOKEN_RE) || []).filter((t) => !isMeaninglessKeyword(t))
}
