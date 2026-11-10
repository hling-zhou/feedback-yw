/**
 * API 巡检压缩与带回（docs/DESIGN-API巡检.md §4.1/§2.3）。
 * 压缩：显式动作 compressPatrolDay(date, pool)——取当日该池失败行，键=(日,客户,池,接口)，
 * 相邻间隔 ≤1h 链式并组；组记录 pre_compress_count/suppressed；metric_name/customer_type 创建时冻结。
 * 重推带回：rebuild 时按 (日,池,接口,客户) 匹配旧组且唯一 → 人工状态带回；歧义/无匹配不带（歧义写审计告警）。
 */
import { getDb } from './db.js'
import { logAudit } from './audit.js'
import { readPatrolRegistryItems } from './patrolRepository.js'
import { storageRepository } from './storageRepository.js'

const CHAIN_WINDOW_MS = 60 * 60 * 1000 // 1h 链式窗口（拍板 2026-11-06）

/**
 * 客户类型标注（2026-11-07 用户拍板·终版）：底稿 4.2 前两条独立判据，两个标签——
 * - 仿真：cmic_ 或 cmic 前缀（忽略大小写）
 * - 测试账号：含 test/ceshi/demo
 * 其余 → 空串（无标记，不打"普通"标签）。仅作展示/筛选维度，**不影响是否需要产品侧处理**
 * （待处理/— 完全由根因规则驱动）；底稿 4.2 其余启发式（政企/个人/企业）无消费方不实现。
 * @param {string | null | undefined} userName
 * @returns {string}
 */
export function classifyCustomerType(userName) {
  const name = String(userName || '').trim()
  if (!name) return ''
  if (/^cmic/i.test(name)) return '仿真'
  if (/test|ceshi|demo/i.test(name)) return '测试账号'
  return ''
}

/**
 * 时间字符串比较辅助：'YYYY-MM-DD HH:MM:SS' → 毫秒（本地时区语义与推送数据一致）。
 * @param {string} timeStr
 */
function toMs(timeStr) {
  return new Date(timeStr.replace(' ', 'T')).getTime()
}

/**
 * 压缩单日单池失败行为失败组。
 * @param {string} date YYYY-MM-DD
 * @param {string} pool 资源池全名
 * @param {{ rebuild?: boolean }} [options] rebuild=true 时先备份旧组人工状态，重建后按唯一匹配带回
 * @returns {{ groups: number, compressedFrom: number }}
 */
export function compressPatrolDay(date, pool, options = {}) {
  const db = getDb()

  // 1. 备份旧组（rebuild 带回用）
  /** @type {Array<{ productKey: string, apiPath: string, userName: string, status: string, assignee: string | null,
  *   confirmed: string | null, feedback: string | null, feedbackBy: string | null, feedbackAt: string | null }>} */
  const oldGroups = []
  if (options.rebuild) {
    const rows = db.prepare(`
      SELECT product_key, api_path, user_name, product_action_status, assignee,
             root_cause_confirmed, measure_feedback, feedback_by, feedback_at
      FROM api_patrol_failure_groups WHERE group_date=? AND pool_name=?
    `).all(date, pool)
    for (const r of rows) {
      oldGroups.push({
        productKey: /** @type {{product_key: string}} */ (r).product_key,
        apiPath: /** @type {{api_path: string}} */ (r).api_path,
        userName: /** @type {{user_name: string}} */ (r).user_name,
        status: /** @type {{product_action_status: string}} */ (r).product_action_status,
        assignee: /** @type {{assignee: string | null}} */ (r).assignee,
        confirmed: /** @type {{root_cause_confirmed: string | null}} */ (r).root_cause_confirmed,
        feedback: /** @type {{measure_feedback: string | null}} */ (r).measure_feedback,
        feedbackBy: /** @type {{feedback_by: string | null}} */ (r).feedback_by,
        feedbackAt: /** @type {{feedback_at: string | null}} */ (r).feedback_at,
      })
    }
  }

  // 2. 删除当日该池旧组（重推重建语义：覆盖写入）
  db.prepare(`DELETE FROM api_patrol_failure_groups WHERE group_date=? AND pool_name=?`).run(date, pool)

  // 3. 取失败行（仅统计口径内：is_success=0；成功行不参与）
  const failRows = db.prepare(`
    SELECT request_id, api_path, product_key, user_name, request_time
    FROM api_patrol_requests
    WHERE request_date=? AND pool_name=? AND is_success=0
    ORDER BY api_path, user_name, request_time
  `).all(date, pool)

  const registry = readPatrolRegistryItems()
  const registryByPath = new Map(registry.map((item) => [item.apiPath, item]))

  // 经办人默认值：产品目录 owners.productManager[0].username（§2.3 表设计）
  const catalog = /** @type {{ products?: Array<{ key: string, owners?: { productManager?: Array<{ username: string }> } }> } | null} */ (
    storageRepository.getMeta('product_catalog_managed_v1')
  )
  /** @type {Map<string, string>} productKey → defaultAssignee */
  const defaultAssigneeByProduct = new Map()
  for (const p of catalog?.products || []) {
    const pm = p.owners?.productManager?.[0]?.username
    if (pm) defaultAssigneeByProduct.set(p.key, pm)
  }

  // 4. 键=(日,客户,池,接口) 分组 → 组内按时间链式并组
  /** @type {Map<string, Array<{requestId: string, requestTime: string}>>} */
  const buckets = new Map()
  for (const row of failRows) {
    const r = /** @type {{request_id: string, api_path: string, product_key: string | null, user_name: string, request_time: string}} */ (row)
    if (!r.api_path) continue // 空接口名行不入压缩（保留在 requests 证据层）
    const key = `${r.api_path}\u0000${r.user_name}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)?.push({ requestId: r.request_id, requestTime: r.request_time })
  }

  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO api_patrol_failure_groups
      (group_date, product_key, pool_name, api_path, metric_name, user_name,
       first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
       customer_type, product_action_status, assignee, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_diagnosis', ?, ?, ?)
  `)

  let groupCount = 0
  let compressedFrom = 0
  /** 每组的写入信息（带回匹配用） */
  const newGroups = []

  for (const [key, events] of buckets) {
    const [apiPath, userName] = key.split('\u0000')
    // 找该键下任意行的 product_key（同键同 api_path，product_key 一致）
    const productKey = failRows.find(
      (r) => /** @type {{api_path: string, user_name: string}} */ (r).api_path === apiPath
        && /** @type {{user_name: string}} */ (r).user_name === userName,
    )?.product_key || 'eip'
    // metric_name 冻结：注册表取
    const regItem = registryByPath.get(apiPath)
    const metricName = regItem?.metricName || ''
    const customerType = classifyCustomerType(userName)

    // 链式并组：相邻 ≤1h 归同组（i=0 为链首，不判间隔）
    let chainStart = 0
    for (let i = 1; i <= events.length; i++) {
      const isBreak = i === events.length
        || toMs(events[i].requestTime) - toMs(events[i - 1].requestTime) > CHAIN_WINDOW_MS
      if (isBreak) {
        const chain = events.slice(chainStart, i)
        const first = chain[0]
        const suppressed = chain.slice(1).map((e) => e.requestId)
        insert.run(
          date, productKey, pool, apiPath, metricName, userName,
          first.requestId, first.requestTime, chain.length,
          JSON.stringify(suppressed), customerType,
          defaultAssigneeByProduct.get(productKey) || null,
          now, now,
        )
        groupCount += 1
        compressedFrom += chain.length
        newGroups.push({ productKey, apiPath, userName })
        chainStart = i
      }
    }
  }

  // 5. 带回（rebuild）：旧组按 (日,池,接口,客户) 匹配新组
  if (options.rebuild && oldGroups.length > 0) {
    const update = db.prepare(`
      UPDATE api_patrol_failure_groups SET
        product_action_status=?, assignee=?, root_cause_confirmed=?,
        measure_feedback=?, feedback_by=?, feedback_at=?, updated_at=?
      WHERE group_date=? AND pool_name=? AND api_path=? AND user_name=?
    `)
    for (const old of oldGroups) {
      const matches = newGroups.filter(
        (g) => g.apiPath === old.apiPath && g.userName === old.userName && g.productKey === old.productKey,
      )
      if (matches.length === 1) {
        const g = matches[0]
        update.run(
          old.status, old.assignee, old.confirmed, old.feedback, old.feedbackBy, old.feedbackAt, now,
          date, pool, g.apiPath, g.userName,
        )
      } else if (matches.length > 1) {
        // 歧义：不带 + 审计告警（绝不静默乱挂）
        logAudit({
          username: 'system',
          action: 'api_patrol.carryback_ambiguous',
          detail: {
            date, pool, apiPath: old.apiPath, userName: old.userName,
            oldStatus: old.status, newGroupCount: matches.length,
            message: '重推后同键拆多组，人工状态不带回，请重新处理',
          },
        })
      }
      // matches.length === 0：旧组消失（数据被重推删除）→ 不带（数据已不存在）
    }
  }

  return { groups: groupCount, compressedFrom }
}
