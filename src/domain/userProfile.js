/**
 * 用户档案枚举：所属班组（team）。
 *
 * 前后端共用同一份定义（server 侧以 `../src/domain/*.js` 方式引用，
 * 与 passwordExpiry.js / passwordPolicy.js 的既有做法一致），
 * 避免出现「前端下拉与后端校验两套名单」的漂移。
 */

/** 所属班组枚举 */
export const TEAMS = [
  'SDN运维产品组',
  '产品运营组',
  '弹性负载均衡产品研发组',
  '弹性负载均衡产品运营组',
  '弹性公网产品组',
  '科研管理组',
  '设计支撑组',
  '算网平台组',
  '算网应用组',
  '天池NFV平台模块团队',
  '天池SDN平台模块团队',
  '天池网关平台模块团队',
  '系统工程组',
  '虚拟网络产品组',
  '云网测试组',
  '专网产品组',
  '综合管理组',
]

/**
 * 存量班组值 → 新枚举的映射。
 *
 * 班组由自由输入改为枚举后，库内已有的旧值需要一次性迁到枚举内。
 * 未在此表中的旧值**保留原样不清除**（生产库取值不可预测），
 * 前端下拉会把它作为额外选项带出，由管理员手工改到合法枚举值。
 */
export const TEAM_MIGRATION_MAP = {
  系统管理: '综合管理组',
  设计组: '设计支撑组',
  验证: '云网测试组',
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isKnownTeam(value) {
  return TEAMS.includes(String(value ?? '').trim())
}

/**
 * @param {unknown} value
 * @returns {string} 命中映射表则返回新班组，否则返回去空格后的原值
 */
export function mapLegacyTeam(value) {
  const raw = String(value ?? '').trim()
  return TEAM_MIGRATION_MAP[raw] || raw
}
