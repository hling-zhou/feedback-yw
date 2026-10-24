/**
 * 导出分析结果脱敏逻辑。
 *
 * 两类脱敏：
 * - 列级脱敏：直接将字段值替换为 ***（loginAccountName / groupCustomerCode / groupName）
 * - 正文级脱敏：对文本字段做正则替换（password / ipAddress）
 */

/** @typedef {'loginAccountName' | 'groupCustomerCode' | 'groupName' | 'password' | 'ipAddress'} DesensitizeFieldKey */

/**
 * @typedef {Object} DesensitizeFieldDef
 * @property {DesensitizeFieldKey} key
 * @property {string} label
 * @property {'column' | 'text'} type
 * @property {string} [sourceColumn] - 列级脱敏对应的 sourceColumns 中文列名
 */

/** @type {DesensitizeFieldDef[]} */
export const DESENSITIZE_FIELDS = [
  { key: 'loginAccountName', label: '登录账号名称', type: 'column', sourceColumn: '登录账号名称' },
  { key: 'groupCustomerCode', label: '客户编码', type: 'column', sourceColumn: '集团客户编码' },
  { key: 'groupName', label: '客户名称', type: 'column', sourceColumn: '集团名称' },
  { key: 'password', label: '密码（正文中出现的密码信息）', type: 'text' },
  { key: 'ipAddress', label: 'IP地址（正文中出现的IP地址）', type: 'text' },
]

/**
 * @typedef {Object} DesensitizeOptions
 * @property {boolean} [loginAccountName]
 * @property {boolean} [groupCustomerCode]
 * @property {boolean} [groupName]
 * @property {boolean} [password]
 * @property {boolean} [ipAddress]
 */

/** @returns {DesensitizeOptions} 全部禁用（不脱敏） */
export function createNoDesensitizeOptions() {
  return {
    loginAccountName: false,
    groupCustomerCode: false,
    groupName: false,
    password: false,
    ipAddress: false,
  }
}

/** @returns {DesensitizeOptions} 全部启用（全脱敏） */
export function createAllDesensitizeOptions() {
  return {
    loginAccountName: true,
    groupCustomerCode: true,
    groupName: true,
    password: true,
    ipAddress: true,
  }
}

/**
 * 列级脱敏：将原始值替换为 ***。
 * 仅对 type='column' 的字段生效。
 *
 * @param {string} value
 * @param {DesensitizeFieldKey} fieldKey
 * @param {DesensitizeOptions} options
 * @returns {string}
 */
export function desensitizeColumnValue(value, fieldKey, options) {
  if (!options?.[fieldKey]) return String(value ?? '')
  return '***'
}

/** IP 正则（匹配 IPv4 格式） */
const IP_REGEX = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g

/** 密码正则：匹配 "密码" / "帐号密码" / "账号密码" 后面的值 */
const PASSWORD_PATTERNS = [
  /(账(?:号)?\s*密码|password|passwd)\s*[:：]?\s*([^\s,，;；\]】}）)]+)/gi,
  /(密码)\s*[:：]\s*([^\s,，;；\]】}）)]+)/gi,
]

/**
 * 正文级脱敏：对文本做正则替换。
 *
 * @param {string} text
 * @param {DesensitizeOptions} options
 * @returns {string}
 */
export function desensitizeText(text, options = {}) {
  let result = String(text ?? '')

  if (options.password) {
    for (const pattern of PASSWORD_PATTERNS) {
      result = result.replace(pattern, (match, label) => {
        return `${label}:****`
      })
    }
  }

  if (options.ipAddress) {
    result = result.replace(IP_REGEX, '***.***.***.***')
  }

  return result
}

/**
 * 判断某个 fieldKey 是否需要正文级脱敏。
 * @param {DesensitizeFieldKey} fieldKey
 * @param {DesensitizeOptions} options
 * @returns {boolean}
 */
export function isTextDesensitizeEnabled(fieldKey, options) {
  return Boolean(options?.[fieldKey])
}

/**
 * 对需要正文脱敏的文本字段列表进行脱敏。
 * 返回脱敏后的文本。
 *
 * @param {string} text
 * @param {DesensitizeOptions} options
 * @returns {string}
 */
export function desensitizeTextField(text, options = {}) {
  return desensitizeText(text, options)
}

/**
 * 获取脱敏字段列表中已启用的字段标签（用于弹窗提示）。
 * @param {DesensitizeOptions} options
 * @returns {string[]}
 */
export function getEnabledDesensitizeLabels(options = {}) {
  return DESENSITIZE_FIELDS
    .filter((field) => options?.[field.key])
    .map((field) => field.label)
}
