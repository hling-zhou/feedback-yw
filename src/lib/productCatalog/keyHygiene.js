/**
 * 产品目录 Key 字符卫生：剥离零宽字符 + 规范校验。
 *
 * 两条路径分治：
 * - **迁移路径**（读取已有目录 / 历史数据自愈）：用 `sanitizeProductKey` 自动剥离零宽 / 不可见字符，
 *   保证旧数据 `CloudDNS\u200c` 能自愈为 `CloudDNS`，不报错。
 * - **录入路径**（用户新建 / 手工填写）：用 `validateProductKey` 严格校验，含零宽字符时 **报错而非静默剥离**。
 *   身份键被悄悄改名比报错更危险——静默剥离会导致用户以为键是 `CloudDNS` 但系统存的是 `CloudDNS\u200c`。
 */

const INVISIBLE_CHAR_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad]/g

/**
 * 剥离键中的零宽 / 不可见字符（U+200B–U+200F ZWSP 等、U+FEFF BOM、U+00AD SHY 等）。
 * @param {string} text
 * @returns {string}
 */
export function stripInvisibleChars(text) {
  const raw = String(text ?? '')
  if (!raw) return ''
  return raw.replace(INVISIBLE_CHAR_RE, '')
}

/**
 * 校验键是否合法：非空、仅允许字母/数字/下划线。
 * 含零宽 / 不可见字符时 **报错**，不静默剥离。
 * @param {string} key
 * @returns {string} 通过校验的键（trim 后）
 * @throws {Error} 键为空或含非法字符
 */
export function validateProductKey(key) {
  const raw = String(key ?? '').trim()
  if (!raw) throw new Error('产品 Key 不能为空')
  if (INVISIBLE_CHAR_RE.test(raw)) {
    throw new Error(
      `产品 Key 含零宽/不可见字符（U+200B 等），请检查输入源：${JSON.stringify(raw)}`,
    )
  }
  if (!/^[A-Za-z0-9_]+$/.test(raw)) {
    throw new Error(`产品 Key 只允许字母、数字、下划线，收到：${JSON.stringify(raw)}`)
  }
  return raw
}

/**
 * 清洗键用于迁移路径：先剥离零宽字符，再校验剩余部分合法。
 * 剥离后若为空则返回空字符串（不报错，由调用方判断是否跳过）。
 * @param {string} key
 * @returns {string}
 */
export function sanitizeProductKey(key) {
  const stripped = stripInvisibleChars(String(key ?? '')).trim()
  if (!stripped) return ''
  // 剥离后剩余部分仍可能含其他非法字符，但不报错——迁移路径只做清洗
  if (!/^[A-Za-z0-9_]+$/.test(stripped)) return stripped
  return stripped
}
