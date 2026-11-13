/**
 * 用后即评溯源/回访与举措库的多条关联。
 * actionIds 是新真源；仅当旧记录没有该字段时，才读取单条 actionId。
 * 显式空数组代表人工清空，不能回退到旧 actionId。
 * @param {unknown} actionIds
 * @param {unknown} legacyActionId
 * @returns {string[]}
 */
export function normalizePostUseActionIds(actionIds, legacyActionId = '') {
  if (!Array.isArray(actionIds)) {
    const legacy = String(legacyActionId || '').trim()
    return legacy ? [legacy] : []
  }
  return [...new Set(actionIds.map((id) => String(id || '').trim()).filter(Boolean))]
}

/** @param {Record<string, any>} record @param {string[]} actionIds */
export function withPostUseActionIds(record, actionIds) {
  const normalized = normalizePostUseActionIds(actionIds)
  return { ...record, actionIds: normalized, actionId: normalized[0] || '' }
}

/**
 * 多条举措按同一序号写入三个导出列，空详情和排期占位，保证 Excel 各列对齐。
 * 单条维持原有的纯文本格式。
 * @param {Record<string, any>} record
 * @param {Map<string, { content?: string; detail?: string; scheduleAt?: string }>} items
 */
export function postUseActionExportCells(record, items) {
  const actionIds = normalizePostUseActionIds(record?.actionIds, record?.actionId)
  const linked = actionIds.map((id) => items.get(id))
  if (!linked.length) return { content: '', detail: '', schedule: '' }
  if (linked.length === 1) {
    return {
      content: String(linked[0]?.content || ''),
      detail: String(linked[0]?.detail || ''),
      schedule: String(linked[0]?.scheduleAt || ''),
    }
  }
  const numbered = (field) => linked.map((item, index) =>
    `${index + 1}. ${String(item?.[field] || '—')}`).join('\n')
  return {
    content: numbered('content'),
    detail: numbered('detail'),
    schedule: numbered('scheduleAt'),
  }
}
