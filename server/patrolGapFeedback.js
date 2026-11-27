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

/**
 * 聚合键构造（单源——写入与查询判定必经此处，防 join 分隔符漂移）。
 * 两态（11-27 19:09 补：分区一池级反馈入口）：
 * - 聚合键 `agg:产品key|接口|池名`（分区二——三段必填）；
 * - 池级键 `pool:池名`（分区一——池未接入的核实记录：apiPath/productKey 传空即池级）。
 * @returns {string}
 */
export function buildGapFeedbackKey(productKey, apiPath, poolName) {
  if (!String(productKey || '').trim() && !String(apiPath || '').trim() && String(poolName || '').trim()) {
    return `pool:${String(poolName).trim()}`
  }
  return `agg:${String(productKey || '')}|${String(apiPath || '')}|${String(poolName || '')}`
}

/**
 * 规范化反馈行（容错 + 必填校验——reason 空=无效行丢弃，meta 手工编辑防崩）。
 * 11-27 19:09 验证补丁：长度/格式校验——超长 reason 会复现导出 xlsx 32767 单元格炸 write
 * （同族坑：无校验时 21000 字符实锤入库）；scheduleAt 必须 yyyy-MM-dd（非法值回填
 * DatePicker=Invalid Date 前端形态破坏）。
 * @param {any} raw
 * @returns {PatrolGapFeedbackItem | null}
 */
const REASON_MAX_LEN = 500
const FIX_PLAN_MAX_LEN = 500
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/**
 * 规范化反馈行。两态语义（11-27 19:09 修订）：
 * - strict=true（写路径 putGapFeedback）：违规 throw（400 回给提交人）；
 * - strict=false（读路径 listPatrolGapFeedback 容错解析）：违规行丢弃返回 null——
 *   **读路径严禁 throw**：一条脏数据（meta 手工编辑/历史形态）炸掉整个需求池 summary
 *   不可接受（先例语义：normalizeRule 读路径丢弃制）。
 * @param {any} raw
 * @param {boolean} [strict]
 * @returns {PatrolGapFeedbackItem | null}
 */
function normalizeItem(raw, strict = false) {
  const fail = (msg) => {
    if (strict) throw new Error(msg)
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const productKey = String(raw.productKey || '').trim()
  const apiPath = String(raw.apiPath || '').trim()
  const poolName = String(raw.poolName || '').trim()
  const reason = String(raw.reason || '').trim()
  // 两态必填：池级（productKey/apiPath 空）只需 poolName+reason；聚合级三段+reason 全必填
  if (!reason || !poolName || (!productKey && apiPath)) return strict ? null : null
  if (!productKey && !apiPath) {
    // 池级条目：key 由 buildGapFeedbackKey 生成 pool: 形态
    if (reason.length > REASON_MAX_LEN) return fail(`核实原因超长（${reason.length} 字符，上限 ${REASON_MAX_LEN}）`)
    const sch1 = String(raw.scheduleAt || '').trim()
    if (sch1 && !DATE_RE.test(sch1)) return fail('排期时间格式必须为 yyyy-MM-dd')
    const fp1 = String(raw.fixPlan || '').trim()
    if (fp1.length > FIX_PLAN_MAX_LEN) return fail(`修复方案超长（${fp1.length} 字符，上限 ${FIX_PLAN_MAX_LEN}）`)
    return {
      key: buildGapFeedbackKey('', '', poolName),
      productKey: '', apiPath: '', poolName, reason,
      fixPlan: fp1, scheduleAt: sch1,
      feedbackBy: String(raw.feedbackBy || ''), feedbackAt: String(raw.feedbackAt || ''),
    }
  }
  if (reason.length > REASON_MAX_LEN) return fail(`核实原因超长（${reason.length} 字符，上限 ${REASON_MAX_LEN}）`)
  const fixPlan = String(raw.fixPlan || '').trim()
  if (fixPlan.length > FIX_PLAN_MAX_LEN) return fail(`修复方案超长（${fixPlan.length} 字符，上限 ${FIX_PLAN_MAX_LEN}）`)
  const scheduleAt = String(raw.scheduleAt || '').trim()
  if (scheduleAt && !DATE_RE.test(scheduleAt)) return fail('排期时间格式必须为 yyyy-MM-dd')
  return {
    key: buildGapFeedbackKey(productKey, apiPath, poolName),
    productKey, apiPath, poolName, reason,
    fixPlan,
    scheduleAt,
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
  const item = normalizeItem({ ...input, feedbackBy: opts.username || 'unknown', feedbackAt: new Date().toISOString() }, true)
  if (!item) throw new Error('核实原因必填（池级只需资源池；聚合级需产品+接口+资源池）')
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
