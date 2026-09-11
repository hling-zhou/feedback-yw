/**
 * 举措库 inventory 接入 — 为每条行动建议查询关联举措状态。
 *
 * 口径约定（已对齐）：
 * - "是否纳入优化"权威来源 = 举措库（action_items 表）中按产品+主题匹配的举措状态
 * - open = pending_evaluation / in_progress / suspended
 * - done = completed（done ≠ 已根治，只证明动作做了）
 * - stopped = not_implemented / abnormal_terminated
 * - none = 无关联举措
 *
 * @see docs/DESIGN-行动建议新方案-完整实现.md §3
 */

/** @typedef {'open' | 'done' | 'stopped' | 'none'} InventoryStatus */
/** @typedef {import('../domain/overviewConclusions.js').ActionRecsResult} ActionRecsResult */

const OPEN_STATUSES = new Set(['pending_evaluation', 'in_progress', 'suspended'])
const DONE_STATUSES = new Set(['completed'])
const STOPPED_STATUSES = new Set(['not_implemented', 'abnormal_terminated'])

/**
 * 从 ActionRecsResult 的 summary 中提取匹配关键词。
 * summary 格式如 "网络链路质量 · 丢包"。
 * @param {ActionRecsResult} rec
 */
function extractMatchKeys(rec) {
  const product = rec?.scope?.product || ''
  const summary = rec?.summary || ''
  // 去掉 " · " 分隔符后的子议题部分
  const [family, sub] = summary.split(/\s*[·]\s*/)
  return { product, family: (family || '').trim(), sub: (sub || '').trim() }
}

/**
 * 判断一个 ActionItem 是否匹配某个 rec。
 * 匹配规则：产品名包含或被包含 rec 的产品，且 insightTheme 或 painPointSnapshot 包含 rec 的 family 或 sub 关键词。
 *
 * @param {object} item - ActionItem
 * @param {{ product: string, family: string, sub: string }} keys
 */
function actionItemMatches(item, keys) {
  const itemProduct = String(item.productName || item.productKey || '').trim()
  if (keys.product && itemProduct) {
    const p = keys.product.replace(/\s/g, '')
    const ip = itemProduct.replace(/\s/g, '')
    if (!p.includes(ip) && !ip.includes(p)) return false
  }
  const theme = String(item.insightTheme || '').trim()
  const pain = String(item.painPointSnapshot || '').trim()
  const problemType = String(item.problemTypeSnapshot || '').trim()
  const blob = [theme, pain, problemType].join(' ')
  if (!keys.family && !keys.sub) return true
  // 优先匹配 sub（更精确），回退 family
  if (keys.sub && blob.includes(keys.sub)) return true
  if (keys.family && blob.includes(keys.family)) return true
  return false
}

/**
 * 聚合一批匹配的 ActionItems 为 inventoryStatus。
 * 优先级：open > done > stopped > none
 *
 * @param {object[]} matchedItems
 * @returns {InventoryStatus}
 */
function aggregateStatus(matchedItems) {
  if (!matchedItems || matchedItems.length === 0) return 'none'
  let hasOpen = false, hasDone = false, hasStopped = false
  for (const item of matchedItems) {
    const status = String(item.status || '')
    if (OPEN_STATUSES.has(status)) hasOpen = true
    else if (DONE_STATUSES.has(status)) hasDone = true
    else if (STOPPED_STATUSES.has(status)) hasStopped = true
  }
  // 优先级：有 open → open（正在做），无 open 有 done → done（做了），无 open 无 done 有 stopped → stopped（停了），否则 none
  if (hasOpen) return 'open'
  if (hasDone) return 'done'
  if (hasStopped) return 'stopped'
  return 'none'
}

/**
 * 为一批 ActionRecsResult 填充 inventoryStatus。
 * 在快照重建时调用（服务端），需要传入 actionItemRepository。
 *
 * @param {ActionRecsResult[]} recommendations
 * @param {{ listActionItems: (query: object) => { items: object[] } }} actionItemRepo
 * @returns {ActionRecsResult[]}
 */
export function enrichWithInventory(recommendations, actionItemRepo) {
  if (!actionItemRepo || !recommendations.length) return recommendations

  // 批量拉取所有举措（limit 500，覆盖绝大多数场景）
  let allItems = []
  try {
    const result = actionItemRepo.listActionItems({ limit: 500, offset: 0 })
    // async repo 在同步快照构建中不支持——明确警告并跳过
    if (result && typeof result.then === 'function') {
      console.warn('[actionRecsInventory] async listActionItems not supported in sync snapshot build, skipping inventory enrichment')
      return recommendations
    }
    allItems = result?.items || []
  } catch (e) {
    console.warn('[actionRecsInventory] listActionItems failed:', e?.message || e)
    return recommendations
  }

  return doEnrich(recommendations, allItems)
}

/**
 * 实际的 inventory 填充逻辑。
 * @param {ActionRecsResult[]} recommendations
 * @param {object[]} allItems
 * @returns {ActionRecsResult[]}
 */
function doEnrich(recommendations, allItems) {
  // 按产品分组
  /** @type {Map<string, object[]>} */
  const byProduct = new Map()
  for (const item of allItems) {
    const p = String(item.productName || item.productKey || '').replace(/\s/g, '')
    if (!p) continue
    if (!byProduct.has(p)) byProduct.set(p, [])
    byProduct.get(p).push(item)
  }

  // 为每条 rec 匹配
  for (const rec of recommendations) {
    try {
      const keys = extractMatchKeys(rec)
      const productKey = keys.product.replace(/\s/g, '')
      // 精确匹配产品，回退全量
      const candidates = byProduct.get(productKey) || allItems
      const matched = candidates.filter((item) => actionItemMatches(item, keys))
      rec.inventoryStatus = aggregateStatus(matched)
      // 附加关联举措摘要（用于详情抽屉展示）
      if (matched.length > 0) {
        rec.inventoryActions = matched.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.content || item.detail || '未命名举措',
          status: item.status || '',
          productName: item.productName || '',
        }))
      }
    } catch {
      rec.inventoryStatus = 'none'
    }
  }

  return recommendations
}
