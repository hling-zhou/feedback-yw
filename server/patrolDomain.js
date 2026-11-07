/**
 * API 巡检推送领域逻辑（docs/DESIGN-API巡检.md §3）。
 * 纯逻辑层：产品映射/归属判定/两种 CSV 归一/统计行解析。
 * 库操作在路由层（patrolPush.js）；本模块可独立测试。
 */

/** @typedef {import('./patrolSeeds.js').PatrolApiRegistryItem} PatrolApiRegistryItem */

/**
 * 产品名 → key 两级映射（设计 §3.2：name 精确 → key → 400）。
 * @param {string} product 外部推送的产品名（中文名或英文 key）
 * @param {{ key: string, name: string }[]} catalogProducts 产品目录记录
 * @returns {string | null} 命中返回 key，未命中返回 null
 */
export function resolvePatrolProductKey(product, catalogProducts) {
  const raw = String(product || '').trim()
  if (!raw) return null
  const byName = catalogProducts.find((p) => p.name === raw)
  if (byName) return byName.key
  const byKey = catalogProducts.find((p) => p.key === raw)
  if (byKey) return byKey.key
  return null
}

/**
 * EIP/VPC 混装包单行归属判定（设计 §3.2/§5）：注册表精确 → 启发式 → null+登记告警。
 * @param {string} apiPath
 * @param {PatrolApiRegistryItem[]} registryItems
 * @returns {{ productKey: string | null, heuristic: boolean }}
 */
export function resolveRequestProductKey(apiPath, registryItems) {
  const path = String(apiPath || '').trim()
  if (!path) return { productKey: null, heuristic: false }
  const hit = registryItems.find((item) => item.apiPath === path)
  if (hit) return { productKey: hit.productKey, heuristic: false }
  // 底稿 3.3 启发式：/acl/v3/havip、/customer/v3/network 开头判 VPC；
  // 路径段含 port/havip/subnet/router/vpc 判 VPC；其余判 EIP。
  const lower = path.toLowerCase()
  if (lower.startsWith('/acl/v3/havip') || lower.startsWith('/customer/v3/network')) {
    return { productKey: 'vpc', heuristic: true }
  }
  const segments = lower.split('/').filter(Boolean)
  if (segments.some((s) => ['port', 'havip', 'subnet', 'router', 'vpc'].includes(s))) {
    return { productKey: 'vpc', heuristic: true }
  }
  return { productKey: 'eip', heuristic: true }
}

/**
 * 统计行解析：成功率/正常比例 百分数文本 → REAL；"-" → null（设计 §2.1）。
 * @param {string | undefined} raw
 * @returns {number | null} 解析失败返回 null（由调用方计入 ignored）
 */
export function parsePercent(raw) {
  if (raw == null) return null
  const text = String(raw).trim()
  if (!text || text === '-') return null
  const m = /^(\d+(?:\.\d+)?)\s*%$/.exec(text)
  if (!m) return NaN // 显式 NaN：非法形态（如 "abc"），调用方判 isNaN 计入 ignored
  return Number(m[1])
}

/** 日期合法性：YYYY-MM-DD。 */
export function isValidPatrolDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))
}

/**
 * EIP/VPC 明细行 → 归一记录（设计 §2.2 列映射）。
 * @param {Record<string, string>} row 原样 CSV 列（JSON key 原列名）
 * @returns {{ externalRowId: number | null, requestId: string, apiPath: string,
 *   userId: string, userName: string, isSuccess: number, durationMs: number | null,
 *   requestTime: string, endTime: string | null, bizCategory: string | null,
 *   bizTarget: string | null, bizNo: string | null, errorMessage: string | null,
 *   pushedDiagnose: string | null, appId: string | null } | null} 行不完整返回 null（ignored）
 */
export function normalizeEipVpcRow(row) {
  const requestId = String(row.requestId || '').trim()
  const apiPath = String(row.requestMapping || '').trim()
  const requestTime = String(row.createTime || '').trim()
  if (!requestId || !requestTime) return null
  const result = String(row.result || '').trim()
  const isSuccess = result === '1' ? 1 : result === '0' ? 0 : -1
  if (isSuccess === -1) return null
  const externalRowId = row.id != null && String(row.id).trim() !== '' ? Number(row.id) : null
  return {
    externalRowId: Number.isFinite(externalRowId) ? externalRowId : null,
    requestId,
    apiPath,
    userId: String(row.userId || ''),
    userName: String(row.userName || ''),
    isSuccess,
    durationMs: row.executionTimeMillis != null && String(row.executionTimeMillis).trim() !== ''
      ? Number(row.executionTimeMillis)
      : null,
    requestTime,
    endTime: null,
    bizCategory: String(row.bizCategory || '') || null,
    bizTarget: String(row.bizTarget || '') || null,
    bizNo: String(row.bizNo || '') || null,
    errorMessage: null,
    pushedDiagnose: String(row.diagnoseResult || '') || null,
    appId: row.appId != null ? String(row.appId) : null, // 样例恒空串：空串原样保留（设计 §2.2 四字段保留）
  }
}

/**
 * ELB 明细行 → 归一记录。api_path = resourceType/resourceOperation（设计 §2.2）。
 * @param {Record<string, string>} row
 */
export function normalizeElbRow(row) {
  const requestId = String(row.requestId || '').trim()
  const resourceType = String(row.resourceType || '').trim()
  const resourceOperation = String(row.resourceOperation || '').trim()
  const requestTime = String(row.startTime || '').trim()
  if (!requestId || !requestTime) return null
  const status = String(row.resultStatus || '').trim()
  const isSuccess = status === 'SUCCESS' ? 1 : status === 'FAILED' ? 0 : -1
  if (isSuccess === -1) return null
  const externalRowId = row.id != null && String(row.id).trim() !== '' ? Number(row.id) : null
  return {
    externalRowId: Number.isFinite(externalRowId) ? externalRowId : null,
    requestId,
    apiPath: resourceType && resourceOperation ? `${resourceType}/${resourceOperation}` : resourceType,
    userId: String(row.userId || ''),
    userName: String(row.userName || ''),
    isSuccess,
    durationMs: row.executionTimeMillis != null && String(row.executionTimeMillis).trim() !== ''
      ? Number(row.executionTimeMillis)
      : null,
    requestTime,
    endTime: String(row.endTime || '') || null,
    bizCategory: null,
    bizTarget: null,
    bizNo: null,
    errorMessage: String(row.errorMessage || '') || null,
    pushedDiagnose: String(row.diagnoseResult || '') || null,
    appId: null,
  }
}
