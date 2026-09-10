/**
 * 处理意见质量筛选 + 结论方向提取 + 结构信号交叉验证
 *
 * 链路：工单标题/请求节点（候选信号）× 处理意见结论（验证器）→ 可信信号补全
 * 原则：
 *  1. 工单标题/请求节点是创建时人工选的，44% 是"全局流转"默认值，不能直接采信
 *  2. 处理意见本身也要先过质量筛选——只有含根因结论(A)或处置动作(B)的才有验证能力
 *  3. 结构候选信号只有在与处理意见结论方向一致时才补入分类语料
 *  4. 处理意见无可用结论时（C/D/E），不注入结构信号——customerRequest 本身就是最佳信号
 */

import { stripTaggingNoise } from './workflowTextCleanup.js'

// ── 处理意见质量分层 ──

/** 根因/定位/结论性语句 */
const ROOT_CAUSE_RE =
  /(?:经(?:排查|核实)[，,]?|定位为[：:]?|确认为|实际为|属于|判定为|根因为?[：:]?|原因是?[:：]|问题原因[：:]|由于[^。\n]{4,40}导致|问题在于)/

/** 处置动作语句（已通知/已协助/请客户做X）——有方向性但不如根因精确 */
const ACTION_RE =
  /(?:已(?:通知|告知|协助|指导|回电|处理|解决|关闭|退订|解绑|绑定|配置|调整|恢复|释放|扩容|提升|开通|创建)|请(?:客户|协助|帮忙|后台|服务台)|建议客户|协助客户|已为客户|代客户)/

/** 客户回显（非结论） */
const VOICE_RE =
  /(?:客户(?:反馈|表示|要求|咨询|原话|反应)|用户(?:反馈|表示))/

/** 纯模板/流转 */
const TEMPLATE_RE =
  /(?:敏感信息|机密信息|请.*提供|请.*扫码|请.*进群|如有问题.*(?:咨询|联系)|工单保留|暂未回复|待客户(?:补充|回复|提供))/

/** 处理意见中的结论方向关键词 → 映射到问题维度信号 */
const CONCLUSION_DIRECTION_MAP = {
  // 连通性/可用性
  不通: ['连通性', '可用性'],
  无法访问: ['连通性', '可用性'],
  中断: ['连通性', '可用性'],
  不可用: ['连通性', '可用性'],
  掉线: ['连通性', '可用性'],
  ping: ['连通性'],
  // 性能
  慢: ['性能'],
  卡顿: ['性能'],
  丢包: ['性能'],
  延迟: ['性能'],
  抖动: ['性能'],
  // 配额
  配额: ['配额'],
  售罄: ['配额'],
  上限: ['配额'],
  // 配置
  安全组: ['配置'],
  子网: ['配置'],
  路由: ['配置'],
  防火墙: ['配置'],
  绑定: ['配置'],
  解绑: ['配置'],
  // 开通/创建
  开通: ['开通'],
  创建: ['开通'],
  订购: ['开通'],
  申购: ['开通'],
  // 退订
  退订: ['退订'],
  释放: ['退订'],
  删除: ['退订'],
  // 计费
  欠费: ['计费'],
  账单: ['计费'],
  扣费: ['计费'],
  出账: ['计费'],
  费用: ['计费'],
  折扣: ['计费'],
  // 变更/修改
  变更: ['变更'],
  修改: ['变更'],
  调整: ['变更'],
}

/** 工单标题/请求节点中的操作类型候选词 */
const STRUCTURAL_OP_KEYWORDS = [
  '退订', '释放', '删除', '开通', '创建', '订购', '申购',
  '变更', '修改', '调整', '咨询', '查询', '故障', '异常',
  '中断', '连接', '访问', '带宽', '配额', '安全组', '子网',
  '路由', '防火墙', '绑定', '解绑', '扩容', '提升', '续订',
  '出账', '欠费', '计费', '备案', 'DNS', '证书', 'SSL',
]

/**
 * 处理意见质量分层
 * @param {string} handlingText
 * @returns {'root_cause' | 'action' | 'voice' | 'template' | 'empty' | 'other'}
 */
export function classifyHandlingQuality(handlingText) {
  const t = (handlingText || '').trim()
  if (!t || t === '\\N' || t === 'N' || t === 'null' || t === 'NA') return 'empty'

  const sentences = t
    .split(/[。；\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4)

  if (!sentences.length) return 'empty'

  const hasRc = sentences.some((s) => ROOT_CAUSE_RE.test(s))
  if (hasRc) return 'root_cause'

  const hasAction = sentences.some((s) => ACTION_RE.test(s))
  if (hasAction) return 'action'

  const hasVoice = sentences.some((s) => VOICE_RE.test(s))
  if (hasVoice) return 'voice'

  const hasTemplate = sentences.some((s) => TEMPLATE_RE.test(s))
  if (hasTemplate) return 'template'

  return 'other'
}

/**
 * 处理意见是否可用于验证（A+B 层）
 * @param {string} qualityTier
 */
export function isHandlingVerifiable(qualityTier) {
  return qualityTier === 'root_cause' || qualityTier === 'action'
}

/**
 * 从处理意见文本中提取结论方向关键词
 * @param {string} handlingText
 * @returns {string[]} 结论方向关键词列表（去重）
 */
export function extractHandlingConclusionSignals(handlingText) {
  const t = (handlingText || '').trim()
  if (!t) return []

  // 先清洗掉流转前缀
  const cleaned = stripTaggingNoise(t)

  // 提取结论性语句
  const conclusionSentences = []
  const allSentences = cleaned
    .split(/[。；\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4)

  for (const s of allSentences) {
    if (ROOT_CAUSE_RE.test(s) || ACTION_RE.test(s)) {
      conclusionSentences.push(s)
    }
  }

  if (!conclusionSentences.length) return []

  // 从结论语句中提取方向关键词
  const conclusionText = conclusionSentences.join(' ')
  const signals = new Set()

  for (const [keyword] of Object.entries(CONCLUSION_DIRECTION_MAP)) {
    if (conclusionText.includes(keyword)) {
      signals.add(keyword)
    }
  }

  return [...signals]
}

// ── 结构信号候选提取 ──

/** 解析请求节点/系统路径行 */
const NODE_LINE_RE = /(?:请求节点|系统路径)[：:]\s*([^\n]+)/i

/** 解析工单标题行 */
const TITLE_LINE_RE = /工单标题[：:]\s*([^\n]+)/i

/** "全局流转" 等无效默认值 */
const DEFAULT_NODE_RE = /全局流转|业务规则咨询\/查询/

/**
 * 从 rawText/handlingText 提取结构信号候选
 * @param {string} rawText
 * @param {string} handlingText
 * @returns {{ titleValue: string, nodeSegments: string[], candidateKeywords: string[] }}
 */
export function extractStructuralCandidates(rawText, handlingText) {
  const full = [rawText || '', handlingText || ''].join('\n')

  const titleMatch = full.match(TITLE_LINE_RE)
  const nodeMatch = full.match(NODE_LINE_RE)

  let titleValue = ''
  let nodeSegments = []

  // 解析请求节点分段
  if (nodeMatch) {
    const rawNode = nodeMatch[1].trim()
    // 如果是"全局流转"默认值，不采信
    if (!DEFAULT_NODE_RE.test(rawNode)) {
      nodeSegments = rawNode
        .split('--')
        .map((s) => s.trim())
        .filter((s) => s && !DEFAULT_NODE_RE.test(s) && s.length >= 2)
      // 第二段经常糊入"工单标题：..."，截断
      nodeSegments = nodeSegments.map((seg) => {
        const cut = seg.search(/工单标题[：:]/i)
        return cut >= 0 ? seg.slice(0, cut).trim() : seg
      }).filter((s) => s.length >= 2)
    }
  }

  // 解析工单标题值
  if (titleMatch) {
    titleValue = titleMatch[1].trim()
    // 标题值经常糊入"详细内容：..."，截断
    const cutIdx = titleValue.search(/详细内容\s*[：:]/i)
    if (cutIdx >= 0) titleValue = titleValue.slice(0, cutIdx).trim()
    // 默认值不采信
    if (DEFAULT_NODE_RE.test(titleValue)) titleValue = ''
  }

  // 从 nodeSegments + titleValue 提取候选关键词
  const candidateText = [...nodeSegments, titleValue].join(' ')
  const candidateKeywords = []

  for (const kw of STRUCTURAL_OP_KEYWORDS) {
    if (candidateText.includes(kw)) {
      candidateKeywords.push(kw)
    }
  }

  return { titleValue, nodeSegments, candidateKeywords }
}

// ── 交叉验证 ──

/**
 * 将关键词映射到信号维度
 * @param {string[]} keywords
 * @returns {Set<string>}
 */
function keywordsToDirections(keywords) {
  const dirs = new Set()
  for (const kw of keywords) {
    const mapped = CONCLUSION_DIRECTION_MAP[kw]
    if (mapped) {
      mapped.forEach((d) => dirs.add(d))
    }
  }
  return dirs
}

/**
 * 交叉验证结构候选信号与处理意见结论
 * 只返回通过验证的信号（两者方向一致的）
 *
 * @param {string[]} structuralCandidates 结构候选关键词
 * @param {string[]} handlingSignals 处理意见结论关键词
 * @param {string} customerRequest 客户请求（已提取的客户原声）
 * @returns {string[]} 通过验证的、customerRequest 中缺失的信号关键词
 */
export function crossVerifySignals(structuralCandidates, handlingSignals, customerRequest) {
  if (!structuralCandidates.length || !handlingSignals.length) return []

  // 将两边关键词都映射到方向维度
  const structDirs = keywordsToDirections(structuralCandidates)
  const handlingDirs = keywordsToDirections(handlingSignals)

  // 取交集：结构候选和处理意见都指向的方向
  const verifiedDirs = new Set()
  for (const d of structDirs) {
    if (handlingDirs.has(d)) verifiedDirs.add(d)
  }

  if (!verifiedDirs.size) return []

  // 从结构候选中选词：该词的方向在 verifiedDirs 中，且不在 customerRequest 中
  const cr = customerRequest || ''
  const verified = []

  for (const kw of structuralCandidates) {
    const mapped = CONCLUSION_DIRECTION_MAP[kw]
    if (!mapped) continue
    if (mapped.some((d) => verifiedDirs.has(d)) && !cr.includes(kw)) {
      verified.push(kw)
    }
  }

  return [...new Set(verified)]
}

/**
 * 主入口：从工单全文提取并验证可信的补全信号
 *
 * @param {Object} input
 * @param {string} [input.rawText]
 * @param {string} [input.handlingText]
 * @param {string} [input.customerRequest]
 * @returns {string} 验证通过的、可追加到分类语料的信号文本（如 "安全组 变更 子网"）；无则返回 ''
 */
export function extractVerifiedSupplementSignals(input = {}) {
  const rawText = input.rawText || ''
  const handlingText = input.handlingText || ''
  const customerRequest = (input.customerRequest || '').trim()

  // 1. 处理意见质量筛选
  const qualityTier = classifyHandlingQuality(handlingText)
  if (!isHandlingVerifiable(qualityTier)) return ''

  // 2. 提取处理意见结论方向
  const handlingSignals = extractHandlingConclusionSignals(handlingText)
  if (!handlingSignals.length) return ''

  // 3. 提取结构信号候选
  const { candidateKeywords } = extractStructuralCandidates(rawText, handlingText)
  if (!candidateKeywords.length) return ''

  // 4. 交叉验证
  const verified = crossVerifySignals(candidateKeywords, handlingSignals, customerRequest)
  if (!verified.length) return ''

  return verified.join(' ')
}
