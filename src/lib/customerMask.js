/**
 * 客户姓名脱敏（共享单源，11-18 复盘拍板：脱敏类判定出现新消费方即抽共享，不受"第 3 处"计数约束）。
 * 形态：首字符 + **** + 尾字符；两字以内只留首字。两处消费方（V2 报告文档层、报告待办候选层）必须同形，
 * 脱敏形态漂移 = 安全类缺陷。
 * @param {string} value 原始客户姓名
 * @param {{ empty?: string }} [options] empty：空值返回（文档层沿用 '—' 占位；候选层用 ''）
 * @returns {string}
 */
export function maskCustomerName(value, options = {}) {
  const text = String(value || '').trim()
  if (!text) return options.empty ?? ''
  if (text.length <= 2) return `${text[0]}****`
  return `${text.slice(0, 1)}****${text.slice(-1)}`
}

/** 中国大陆手机号（1[3-9] 开头 11 位），前后无字母数字才命中，避免误伤工单号/长编码。 */
const PHONE_IN_TEXT_PATTERN = /(?<![\dA-Za-z])1[3-9]\d{9}(?![\dA-Za-z])/g

/**
 * 电话号码打码（展示层共享，11-18 口径：电话号码需要脱敏）：正文中的手机号 → 前3+****+后4。
 * 非手机号形态（工单号、E+长编码、座机）不动。
 * @param {string} text
 * @returns {string}
 */
export function maskPhoneInText(text) {
  return String(text || '').replace(PHONE_IN_TEXT_PATTERN, (phone) => `${phone.slice(0, 3)}****${phone.slice(-4)}`)
}

/**
 * 客户名展示（共享单源，11-18 用户口径）：客户名（企业/机构/账号）明文；
 * 仅对「（聚类客户）姓名」标记后的人名段脱敏 + 文本内手机号打码。
 * 真库依据（51981 条）：自然人姓名仅出现在聚类标记后，无标记纯人名未出现——不做纯人名猜测，避免误杀企业名。
 * @param {string} value
 * @param {{ empty?: string }} [options] empty：空值返回
 * @returns {string}
 */
export function displayCustomerText(value, options = {}) {
  const text = String(value || '').trim()
  if (!text) return options.empty ?? ''
  return maskPhoneInText(text).replace(
    /((?:（|\()聚类客户(?:）|\)))([\u4e00-\u9fa5]{2,4})/g,
    (_all, marker, name) => `${marker}${maskCustomerName(name)}`,
  )
}

