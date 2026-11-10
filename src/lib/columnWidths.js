/**
 * 列宽拖拽（resizable columns）纯函数层。
 *
 * 2026-11-10 方案 v2 拍板：
 * - 排除三类列不挂拖拽手柄：fixed 列、操作列（key: 'actions' / '__deleteAction'）、无 width 弹性列
 * - 持久化：localStorage，key 挂 userId（`fb.table-width.<userId>.<tableKey>`），项目首个 UI 偏好类 Web Storage
 * - scroll.x 必须动态求和（sumColumnsWidth），拖宽后横向滚动联动
 * - min 宽度 48px 下限防拖没
 *
 * 本文件保持纯函数（不依赖 React / DOM），node 环境秒级单测覆盖。
 */

/** 拖拽下限：再窄列头就没了 */
export const MIN_COLUMN_WIDTH = 48

/** 求和时无 width 列的默认宽度（与 FeedbackTable.jsx 历史 fallback 140 一致） */
export const DEFAULT_COLUMN_WIDTH = 140

/** 操作列 key 黑名单：按钮列拖宽无意义 */
const NON_RESIZABLE_KEYS = new Set(['actions', '__deleteAction'])

/**
 * 判断一列是否可挂拖拽手柄。
 * 三类排除：fixed 列（antd 阴影不同步怪癖）、操作列、无 width 弹性列（flex 填充，无声明宽）。
 *
 * @param {{ fixed?: unknown, key?: string, width?: number }} col
 * @returns {boolean}
 */
export function isResizableColumn(col) {
  if (!col) return false
  if (col.fixed) return false
  if (col.key && NON_RESIZABLE_KEYS.has(col.key)) return false
  if (typeof col.width !== 'number' || !Number.isFinite(col.width) || col.width <= 0) return false
  return true
}

/**
 * 列身份键：优先 dataIndex，其次 key。两者皆空的列不参与 resize（无稳定身份无法持久化）。
 * @param {{ dataIndex?: string, key?: string }} col
 * @returns {string}
 */
export function columnIdentityKey(col) {
  if (!col) return ''
  if (typeof col.dataIndex === 'string' && col.dataIndex) return col.dataIndex
  if (typeof col.key === 'string' && col.key) return col.key
  return ''
}

/**
 * 将用户拖拽的宽度 override 应用到列集：可拖列且存在 override 时替换 width。
 * 返回新数组（浅拷贝列对象），不改原列对象。
 *
 * @param {Array<object>} columns
 * @param {Record<string, number> | undefined} widthOverrides
 * @returns {Array<object>}
 */
export function applyColumnWidths(columns, widthOverrides) {
  if (!columns) return columns
  if (!widthOverrides || Object.keys(widthOverrides).length === 0) return columns
  return columns.map((col) => {
    if (!isResizableColumn(col)) return col
    const idKey = columnIdentityKey(col)
    const overridden = widthOverrides[idKey]
    if (typeof overridden !== 'number' || !Number.isFinite(overridden)) return col
    /** @type {any} */
    const anyCol = col
    return { ...col, width: clampColumnWidth(overridden, anyCol.width) }
  })
}

/**
 * clamp 拖拽落点宽度：下限 MIN_COLUMN_WIDTH；上限不设（用户想多宽就多宽，scroll.x 联动）。
 * @param {number} width
 * @param {number} [originalWidth] 声明宽度，无意义时仅用下限
 */
export function clampColumnWidth(width, originalWidth) {
  const w = Number(width)
  if (!Number.isFinite(w)) return typeof originalWidth === 'number' ? originalWidth : MIN_COLUMN_WIDTH
  return Math.max(MIN_COLUMN_WIDTH, Math.round(w))
}

/**
 * scroll.x 动态求和（含弹性列 fallback 默认宽）。与 FeedbackTable.jsx 历史行为一致：
 * `columns.reduce((sum, col) => sum + (col.width || 140), 0)`
 *
 * @param {Array<object>} columns
 * @returns {number}
 */
export function sumColumnsWidth(columns) {
  if (!Array.isArray(columns)) return 0
  return columns.reduce((sum, col) => {
    /** @type {any} */
    const anyCol = col
    return sum + (anyCol?.width || DEFAULT_COLUMN_WIDTH)
  }, 0)
}

/* ------------------------------ 持久化 ------------------------------ */

/**
 * localStorage key：按 userId 隔离（多用户同机器互不可见），按 tableKey 分表。
 * tableKey 由调用方保证唯一稳定（如 'postUseJira' / 'customerVisit' / 'feedback.ticket' / 'feedback.postUse'）。
 *
 * @param {string} userId
 * @param {string} tableKey
 * @returns {string}
 */
export function buildTableWidthStorageKey(userId, tableKey) {
  return `fb.table-width.${userId}.${tableKey}`
}

/**
 * 读持久化的宽度 override。任何异常（隐私模式、quota、JSON 损坏）都吞掉返回空对象——
 * 列宽是纯 UI 偏好，读不到就回默认，绝不能抛错打断页面。
 *
 * @param {string} userId
 * @param {string} tableKey
 * @param {Storage | undefined} [storage] 注入便于测试（默认 window.localStorage）
 * @returns {Record<string, number>}
 */
export function loadColumnWidths(userId, tableKey, storage) {
  const key = buildTableWidthStorageKey(userId, tableKey)
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : undefined)
    if (!store) return {}
    const raw = store.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && k && typeof v === 'number' && Number.isFinite(v) && v >= MIN_COLUMN_WIDTH) {
        result[k] = Math.round(v)
      }
    }
    return result
  } catch {
    return {}
  }
}

/**
 * 写持久化。异常吞掉（quota 满等），列宽存不下就下次重设，不报错。
 *
 * @param {string} userId
 * @param {string} tableKey
 * @param {Record<string, number>} widthOverrides
 * @param {Storage | undefined} [storage]
 */
export function saveColumnWidths(userId, tableKey, widthOverrides, storage) {
  const key = buildTableWidthStorageKey(userId, tableKey)
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : undefined)
    if (!store) return
    if (!widthOverrides || Object.keys(widthOverrides).length === 0) {
      store.removeItem(key)
    } else {
      store.setItem(key, JSON.stringify(widthOverrides))
    }
  } catch {
    // ignore：UI 偏好写失败静默
  }
}

/**
 * 清空该表该用户的持久化宽度（重置入口用）。
 * @param {string} userId
 * @param {string} tableKey
 * @param {Storage | undefined} [storage]
 */
export function clearColumnWidths(userId, tableKey, storage) {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : undefined)
    if (!store) return
    store.removeItem(buildTableWidthStorageKey(userId, tableKey))
  } catch {
    // ignore
  }
}
