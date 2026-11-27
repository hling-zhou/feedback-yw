/**
 * API 巡检·诊断能力需求池反馈闭环（11-27 15:13 拍板：需求池加反馈原因入口+记录闭环）。
 *
 * 背景：需求池把「查不到失败日志」的组汇集给工作台核实，但核实结果无处记录——
 * 分不清哪些条已核实过、原因是什么。本模块给池内条目（聚合键级）提供
 * 「核实原因 + 修复方案 + 排期」的反馈记录，提交即闭环（带标记留池可追溯）。
 *
 * 粒度判据（业务对象身份建模）：反馈针对「产品×接口×池的日志查不到能力需求」
 * （跨日持续存在）而存在，不是某日的失败组（一次性事件）——组按日生成，
 * 同聚合内原因几乎相同；写组表会重复记录+跨日漂移（昨天闭环今天新组又成待核实）。
 *
 * 键形态：`agg:产品key|接口|池名`（与 summary 分区二聚合键同构）。
 * 存储：meta `api_patrol_gap_feedback_v1`（对齐豁免白名单先例——独立模块+meta+缓存）。
 * 跨窗口持久：聚合键暂退窗口（数据修复后）反馈记录保留，复发时自动带出历史核实结论。
 *
 * 字段（11-27 16:36 用户定稿）：reason 核实原因必填；fixPlan 修复方案非必填；
 * scheduleAt 排期时间非必填；feedbackBy/feedbackAt 记录人与时间。
 */
import { storageRepository } from './storageRepository.js'
import { logAudit } from './audit.js'

/** meta key（v1——后续 schema 演进升版本号，读旧写新迁移） */
export const META_KEY_GAP_FEEDBACK = 'api_patrol_gap_feedback_v1'

/** 进程内缓存（写后即时失效——同豁免白名单先例：写少读多，30s TTL 零成本） */
let cachedItems = null
let cachedAt = 0
const CACHE_TTL_MS = 30_000

/**
 * @typedef {Object} PatrolGapFeedbackItem
 * @property {string} key 聚合键 `agg:产品key|接口|池名`
 * @property {string} productKey
 * @property {string} apiPath
 * @property {string} poolName
 * @property {string} reason 核实原因（必填）
 * @property {string} fixPlan 修复方案（非必填）
 * @property {string} scheduleAt 排期时间（yyyy-MM-dd，非必填）
 * @property {string} feedbackBy 核实人
 * @property {string} feedbackAt ISO 时间
 */

/** 聚合键构造（单源——写入与查询判定必经此处，防 join 分隔符漂移） */
export function buildGapFeedbackKey(productKey, apiPath, poolName) {
  return `agg:${String(productKey || '')}|${String(apiPath || '')}|${String(poolName || '')}`
}

/**
 * 规范化反馈行（容错 + 必填校验——reason 空=无效行丢弃，meta 手工编辑防崩）。
 * @param {any} raw
 * @returns {PatrolGapFeedbackItem | null}
 */
function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const productKey = String(raw.productKey || '').trim()
  const apiPath = String(raw.apiPath || '').trim()
  const poolName = String(raw.poolName || '').trim()
  const reason = String(raw.reason || '').trim()
  if (!productKey || !apiPath || !poolName || !reason) return null
  return {
    key: buildGapFeedbackKey(productKey, apiPath, poolName),
    productKey, apiPath, poolName, reason,
    fixPlan: String(raw.fixPlan || '').trim(),
    scheduleAt: String(raw.scheduleAt || '').trim(),
    feedbackBy: String(raw.feedbackBy || ''),
    feedbackAt: String(raw.feedbackAt || ''),
  }
}

/**
 * 读全部反馈（键 → 条目映射）。
 * @returns {Map<string, PatrolGapFeedbackItem>}
 */
export function listPatrolGapFeedback() {
  if (cachedItems && Date.now() - cachedAt < CACHE_TTL_MS) return cachedItems
  /** @type {any} */
  let stored = null
  try { stored = storageRepository.getMeta(META_KEY_GAP_FEEDBACK) } catch { stored = null }
  const items = new Map()
  if (stored && Array.isArray(stored.items)) {
    for (const raw of stored.items) {
      const item = normalizeItem(raw)
      if (item) items.set(item.key, item)
    }
  }
  cachedItems = items
  cachedAt = Date.now()
  return items
}

/**
 * 查单条反馈（summary 注入用）。
 * @returns {PatrolGapFeedbackItem | null}
 */
export function getGapFeedback(productKey, apiPath, poolName) {
  return listPatrolGapFeedback().get(buildGapFeedbackKey(productKey, apiPath, poolName)) || null
}

/**
 * 提交/更新一条反馈（upsert by 聚合键）。
 * @param {{ productKey: string, apiPath: string, poolName: string, reason: string, fixPlan?: string, scheduleAt?: string }} input
 * @param {{ username?: string }} [opts]
 */
export function putGapFeedback(input, opts = {}) {
  const item = normalizeItem({ ...input, feedbackBy: opts.username || 'unknown', feedbackAt: new Date().toISOString() })
  if (!item) throw new Error('核实原因必填，产品/接口/资源池不可为空')
  const all = listPatrolGapFeedback()
  const before = all.get(item.key) || null
  all.set(item.key, item)
  storageRepository.putMeta(META_KEY_GAP_FEEDBACK, { version: 1, updatedAt: new Date().toISOString(), items: [...all.values()] })
  cachedItems = all
  cachedAt = Date.now()
  logAudit({
    username: opts.username || 'unknown',
    action: 'api_patrol.gap_feedback',
    detail: { key: item.key, before: before ? { reason: before.reason, scheduleAt: before.scheduleAt } : null, after: { reason: item.reason, fixPlan: item.fixPlan, scheduleAt: item.scheduleAt } },
  })
  return item
}

/**
 * 撤销反馈（回待核实——误填可逆）。
 * @returns {boolean} 是否确实删除了记录
 */
export function deleteGapFeedback(productKey, apiPath, poolName, opts = {}) {
  const key = buildGapFeedbackKey(productKey, apiPath, poolName)
  const all = listPatrolGapFeedback()
  const before = all.get(key) || null
  if (!before) return false
  all.delete(key)
  storageRepository.putMeta(META_KEY_GAP_FEEDBACK, { version: 1, updatedAt: new Date().toISOString(), items: [...all.values()] })
  cachedItems = all
  cachedAt = Date.now()
  logAudit({
    username: opts.username || 'unknown',
    action: 'api_patrol.gap_feedback_delete',
    detail: { key, reason: before.reason },
  })
  return true
}

/** 清缓存（测试用） */
export function clearGapFeedbackCache() {
  cachedItems = null
  cachedAt = 0
}
