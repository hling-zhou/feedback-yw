/** 空泛话术，禁止作为业务优化举措输出 */
const GENERIC_PHRASES = [
  '待分析',
  '纳入版本规划',
  '制定根本解决方案',
  '复盘处理路径',
  '沉淀为标准作业程序',
  '建立同类问题预防机制',
  '推动产品研发修复并给出明确版本',
  '建议复盘本环节',
  '围绕根因',
  '待观察',
  '持续关注',
  '临时方案',
  '临时规避',
  '请客户观察',
  '已协助客户',
  '自助排查',
  '根因闭环',
  '标准化排查',
  '持续关注',
  '纳入规划',
  '加强运营',
  '提升用户体验',
  '持续优化',
  '专项改进',
  'backlog',
]

/** 行动建议专用：比举措判定更严的空泛模板 */
const GENERIC_RECOMMENDATION_RE = [
  /自助排查与根因闭环/,
  /标准化排查工具/,
  /体验闭环/,
  /根因治理/,
  /制定本周期体验改进/,
  /按产品与旅程环节分解增量/,
  /建立专项看板与周复盘/,
  /推动研发缺陷单闭环/,
  /建立该根因对应的控制台诊断/,
  /减少重复人工协查/,
  /需排查是否由特定产品/,
  /建立限时回访与升级机制/,
  /制定分阶段降万投目标/,
  /为该问题类型梳理\s*TOP\s*根因清单/,
  /在下一周期跟踪.*占比/,
  /跟踪\s*30\s*天.*复发率/,
  /优先补齐自助排查/,
  /结合旅程热点与问题类型，制定/,
  /投诉工单与订单量按月复盘/,
]

/**
 * 是否为工单回单/打标模板复述（禁止进入行动建议概述与详细意见）
 * @param {string} text
 */
export function isTicketDerivedPlanningText(text) {
  if (!text?.trim()) return true
  const t = text.trim()
  if (/针对根因「|针对高频根因「/.test(t)) return true
  if (/建立专项修复与验收标准/.test(t)) return true
  if (/目前进展|协助内容|处理意见|归档意见|受理内容|追加信息/.test(t)) return true
  if (/^原因：|^原因:/.test(t)) return true
  if (/telnet|tracert|ping\s+\d|\d+\.\*?\.\*?\.\*/i.test(t)) return true
  if (/\d{1,3}(?:\.\*|\.\d+|\.\*){2,3}\.\d+/.test(t)) return true
  if (/^\d+\s*[、.【]/.test(t)) return true
  if (/^【[^】]{0,20}$/.test(t)) return true
  if (/从\d+.*(云主机|主机|端口|访问)/.test(t)) return true
  if (/移动云投诉根因[：:]/.test(t)) return true
  if (t.length > 40 && /「[^」]{35,}」/.test(t)) return true
  return false
}

/**
 * @param {string} text
 */
export function isGenericMeasure(text) {
  if (!text?.trim()) return true
  const t = text.trim()
  if (t.length < 12) return true
  if (isTicketDerivedPlanningText(t)) return true
  return GENERIC_PHRASES.some((p) => t.includes(p))
}

/**
 * 行动建议概述/要点是否过于空泛（每期都可能相同）
 * @param {string} text
 */
export function isGenericRecommendationText(text) {
  if (isGenericMeasure(text)) return true
  const t = text.trim()
  return GENERIC_RECOMMENDATION_RE.some((r) => r.test(t))
}

/**
 * @param {string} text
 */
export function isValidRootCause(text) {
  if (!text?.trim()) return false
  const t = text.trim()
  if (t === '待分析' || t === '—') return false
  if (/^围绕根因/.test(t)) return false
  if (t.length < 6) return false
  return !isGenericMeasure(t)
}
