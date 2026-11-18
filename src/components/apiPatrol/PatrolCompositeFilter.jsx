import { useMemo } from 'react'
import CompositeFilter from '../filters/CompositeFilter.jsx'

/**
 * 巡检失败请求列表复合搜索（11-18 拍板）。
 * 复用反馈库通用 CompositeFilter（添加筛选条件 chips 形态——FeedbackCompositeFilter 同款外壳）：
 * - 文本字段（RequestID/指标名称/接口名称/客户名称）：text 编辑器 → 后端各字段 LIKE
 * - 枚举字段（产品/根因 L1/处理状态/客户类型/经办人）：enum 编辑器 → options 注入（带数量统计）
 * 搜索行为：复合筛选 chips 与全字段搜框（q）独立并行——q 由外层搜索框持有。
 */

/** @typedef {'product'|'metricName'|'apiPath'|'requestId'|'userName'|'rootCauseL1'|'status'|'customerType'|'assignee'} PatrolFilterKey */
/** @typedef {Record<string, string>} PatrolFilterValues */

const GROUPS = [
  { label: '文本搜索', keys: ['requestId', 'metricName', 'apiPath', 'userName'] },
  { label: '属性筛选', keys: ['product', 'rootCauseL1', 'status', 'customerType', 'assignee'] },
]

const LABELS = {
  requestId: 'RequestID',
  metricName: '指标名称',
  apiPath: '接口名称',
  userName: '客户名称',
  product: '产品',
  rootCauseL1: '根因 L1',
  status: '处理状态',
  customerType: '客户类型',
  assignee: '经办人',
}

const ENUM_KEYS = new Set(['product', 'rootCauseL1', 'status', 'customerType', 'assignee'])

/**
 * @param {Object} props
 * @param {PatrolFilterValues} props.filters
 * @param {(next: PatrolFilterValues) => void} props.onFiltersChange
 * @param {() => void} props.onClearFilters
 * @param {Record<string, { label: string; value: string; title?: string }[]>} props.enumOptions
 *   各枚举字段的选项（外层注入带数量统计形态：'业务冲突（12）'）
 */
export default function PatrolCompositeFilter({ filters, onFiltersChange, onClearFilters, enumOptions }) {
  const config = useMemo(() => ({
    groups: GROUPS,
    labels: LABELS,
    getEditorKind: (key) => (ENUM_KEYS.has(key) ? 'enum' : 'text'),
    listActiveChipKeys: (values) =>
      /** @type {PatrolFilterKey[]} */ (Object.keys(LABELS)).filter((k) => String(values[k] || '').trim() !== ''),
    countActive: (values) =>
      Object.keys(LABELS).filter((k) => String(values[k] || '').trim() !== '').length,
    formatChipLabel: (key, values) => {
      const v = String(values[key] || '')
      if (ENUM_KEYS.has(key)) {
        const opt = (enumOptions[key] || []).find((o) => o.value === v)
        return opt ? opt.label : v
      }
      return `${LABELS[key]}：${v}`
    },
    isAddDisabled: () => false,
    normalizeEditorKey: (key) => key,
    readDraftValue: (key, values) => (ENUM_KEYS.has(key) ? (values[key] || undefined) : (values[key] || '')),
    buildPatchFromDraft: (key, draft) => ({ [key]: ENUM_KEYS.has(key)
      ? (draft == null ? '' : String(draft))
      : String(draft || '').trim() }),
    isDraftValid: (key, draft) => (ENUM_KEYS.has(key)
      ? draft != null && String(draft) !== ''
      : String(draft || '').trim() !== ''),
    applyPatch: (key, patch, current) => ({ ...current, ...patch }),
    clearKey: (key, current) => {
      const next = { ...current }
      delete next[key]
      return next
    },
    listEnumOptions: (key) => enumOptions[key] || [],
  }), [enumOptions])

  return (
    <CompositeFilter
      filters={filters}
      onFiltersChange={onFiltersChange}
      onClearFilters={onClearFilters}
      config={config}
      className="min-w-0 flex-1"
    />
  )
}
