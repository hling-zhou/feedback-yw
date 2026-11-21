/**
 * API 巡检·产品侧处理豁免白名单（11-21 10:38 拍板：精确组合豁免替代全量仿真豁免）。
 *
 * 背景：11-20 方案②曾按「仿真/测试账号」全量豁免——用户 11-21 10:10 修订：面太大，
 * 可能把该关注的带进去（如真实客户账号名意外含 test 被静默豁免）。收敛为白名单精确匹配：
 * 「客户名 × 接口路径」双全等才豁免——同客户其他接口、同接口其他客户不受影响。
 *
 * 语义边界（两条消费链）：
 * 1. 诊断管线出口豁免（patrolDiagnosisPipeline）：命中 → productAction 强制 '—'
 *    + actionReason 标注（重诊断跑完存量自然带豁免痕迹）；
 * 2. 需求池 summary 防噪声（patrolQuery）：命中组不进分区一/分区二（豁免组既不占产品
 *    处理、也不该出现在「诊断能力需求」池——那是给产品看的建设需求，豁免组不是需求）。
 *
 * 存储：meta `api_patrol_action_exemptions_v1`（migration 式种子：无值时写入首条
 * cmic_sim × L7POLICY/CREATE——2026-11-21 用户需求原话）。前端 Settings 化页面维护
 * （/api-patrol/action-exemptions），PUT 走 manageTags（配置资产）。
 */
import { storageRepository } from './storageRepository.js'
import { logAudit } from './audit.js'

/** meta key（v1——后续 schema 演进升版本号，读旧写新迁移） */
export const META_KEY_ACTION_EXEMPTIONS = 'api_patrol_action_exemptions_v1'

/** 进程内缓存（PUT 后即时失效——写少读多，meta 直读每次 better-sqlite3 prepare 开销可忽略但缓存零成本） */
let cachedRules = null
let cachedAt = 0
const CACHE_TTL_MS = 30_000

/** @typedef {{ id: string, userName: string, apiPath: string, poolName: string, note: string, enabled: boolean, createdAt: string }} PatrolActionExemptionRule */

/**
 * 规范化规则行（容错 + 默认值——meta 手工编辑/历史形态防崩）。
 * 11-21 11:14 拍板：apiPath/poolName 可空——空=匹配任意（字段级通配，非正则）；
 * userName 必填（空客户名=豁免一切，语义不可接受）。
 * @param {any} raw
 * @returns {PatrolActionExemptionRule | null}
 */
function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null
  const userName = String(raw.userName || '').trim()
  if (!userName) return null
  return {
    id: String(raw.id || `rule-${userName}`),
    userName,
    apiPath: String(raw.apiPath || '').trim(),   // 空=任意接口
    poolName: String(raw.poolName || '').trim(), // 空=任意资源池
    note: String(raw.note || '').trim(),
    enabled: raw.enabled !== false,
    createdAt: String(raw.createdAt || ''),
  }
}

/**
 * 读白名单全量（含 enabled=false 行——前端列表要展示全部规则，判定层自行过滤）。
 * @returns {PatrolActionExemptionRule[]}
 */
export function listPatrolActionExemptions() {
  if (cachedRules && Date.now() - cachedAt < CACHE_TTL_MS) return cachedRules
  /** @type {any} */
  let stored = null
  try { stored = storageRepository.getMeta(META_KEY_ACTION_EXEMPTIONS) } catch { /* meta 读失败按空处理 */ }
  let rules = Array.isArray(stored?.rules) ? stored.rules.map(normalizeRule).filter(Boolean) : []
  // migration 式种子：meta 无值时写入首条（11-21 需求原话——cmic_sim × 创建7层访问策略）
  if (!stored && rules.length === 0) {
    rules = [{
      id: 'seed-cmic-sim-l7policy',
      userName: 'cmic_sim',
      apiPath: 'L7POLICY/CREATE',
      poolName: '',  // 空=任意资源池（11-21 11:14 拍板：字段级通配——该客户此接口在所有池豁免）
      note: '创建7层访问策略——仿真流量失败无需产品侧处理（11-21 需求）',
      enabled: true,
      createdAt: new Date().toISOString(),
    }]
    try { putPatrolActionExemptions(rules, { username: 'system-seed' }) } catch { /* 种子失败下次再试 */ }
  }
  cachedRules = rules
  cachedAt = Date.now()
  return rules
}

/**
 * 写白名单（全量覆盖写——前端整表提交）。
 * @param {PatrolActionExemptionRule[]} rules
 * @param {{ username?: string }} [opts] 审计操作者（端点传 request.user.username）
 */
export function putPatrolActionExemptions(rules, opts = {}) {
  const normalized = (Array.isArray(rules) ? rules : []).map(normalizeRule).filter(Boolean)
  storageRepository.putMeta(META_KEY_ACTION_EXEMPTIONS, {
    version: 1,
    updatedAt: new Date().toISOString(),
    rules: normalized,
  })
  cachedRules = normalized
  cachedAt = Date.now()
  logAudit({
    username: String(opts.username || 'system'),
    action: 'api_patrol.action_exemptions_update',
    detail: { count: normalized.length, rules: normalized.map((r) => ({ userName: r.userName, apiPath: r.apiPath, enabled: r.enabled })) },
  })
  return normalized
}

/**
 * 豁免判定（11-21 11:14 拍板：字段级通配——userName 必填全等；apiPath/poolName 空规则=匹配任意，
 * 非空全等。不做正则/子串——扩大匹配面=扩大误豁免面）。管线出口与需求池过滤共用的单一真源。
 * @param {string | null | undefined} userName
 * @param {string | null | undefined} apiPath
 * @param {string | null | undefined} [poolName]
 * @returns {boolean}
 */
export function isExemptFromProductAction(userName, apiPath, poolName) {
  const u = String(userName || '').trim()
  if (!u) return false
  const p = String(apiPath || '').trim()
  const pool = String(poolName || '').trim()
  for (const r of listPatrolActionExemptions()) {
    if (!r.enabled) continue
    if (r.userName !== u) continue
    if (r.apiPath && r.apiPath !== p) continue
    if (r.poolName && r.poolName !== pool) continue
    return true
  }
  return false
}

/** 测试隔离：清缓存（meta 值由测试自行预置/清理）。 */
export function clearPatrolActionExemptionsCache() {
  cachedRules = null
  cachedAt = 0
}
