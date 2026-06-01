export const PASSWORD_MIN_LENGTH = 8

export const PASSWORD_POLICY_HINT =
  '至少 8 位，且包含大写字母、小写字母、数字和特殊字符'

/** @type {RegExp} */
const HAS_UPPER = /[A-Z]/
/** @type {RegExp} */
const HAS_LOWER = /[a-z]/
/** @type {RegExp} */
const HAS_DIGIT = /\d/
/** @type {RegExp} */
const HAS_SPECIAL = /[^A-Za-z0-9]/

/**
 * @param {string} password
 * @returns {{ ok: true } | { ok: false; message: string }}
 */
export function validatePasswordPolicy(password) {
  const value = String(password ?? '')
  if (value.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `密码至少 ${PASSWORD_MIN_LENGTH} 位` }
  }
  if (!HAS_UPPER.test(value)) {
    return { ok: false, message: '密码须包含大写字母' }
  }
  if (!HAS_LOWER.test(value)) {
    return { ok: false, message: '密码须包含小写字母' }
  }
  if (!HAS_DIGIT.test(value)) {
    return { ok: false, message: '密码须包含数字' }
  }
  if (!HAS_SPECIAL.test(value)) {
    return { ok: false, message: '密码须包含特殊字符' }
  }
  return { ok: true }
}

/**
 * Ant Design Form 校验规则
 * @param {string} [label]
 */
export function passwordPolicyFormRule(label = '密码') {
  return {
    validator(_, value) {
      if (!value) return Promise.resolve()
      const result = validatePasswordPolicy(value)
      if (result.ok) return Promise.resolve()
      return Promise.reject(new Error(result.message))
    },
  }
}
