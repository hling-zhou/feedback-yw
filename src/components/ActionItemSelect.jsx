import { useCallback, useEffect, useMemo, useState } from 'react'
import { Select, Spin, Tag } from 'antd'
import { ACTION_ITEM_STATUS_LABELS } from '../domain/actionItem.js'
import { formatActionItemOptionLabel } from '../domain/establishedActionLibrary.js'
import { listActionItems, getActionItem } from '../lib/actionItemClient.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */

/** 举措库下拉不可选「已完成」（需求 0601 §工单详情-7） */
const EXCLUDED_SELECT_STATUSES = new Set(['completed'])

/**
 * @param {ActionItem[]} items
 * @param {string | undefined} productKey
 */
function filterAndSortActionItems(items, productKey) {
  const selectable = items.filter((item) => !EXCLUDED_SELECT_STATUSES.has(item.status))
  const pk = productKey?.trim()
  if (!pk) return selectable
  return [...selectable].sort((a, b) => {
    const aMatch = a.productKey?.trim() === pk ? 0 : 1
    const bMatch = b.productKey?.trim() === pk ? 0 : 1
    return aMatch - bMatch
  })
}

/**
 * @param {ActionItem} item
 */
function renderActionItemOption(item) {
  return (
    <div className="py-0.5">
      <div className="text-sm leading-snug">{item.content}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Tag className="!mr-0" color="blue">
          {ACTION_ITEM_STATUS_LABELS[item.status] || item.status}
        </Tag>
        {item.scheduleAt?.trim() ? (
          <Tag className="!mr-0">排期 {item.scheduleAt.trim()}</Tag>
        ) : (
          <Tag className="!mr-0">待评估</Tag>
        )}
      </div>
    </div>
  )
}

/**
 * @param {ActionItem[]} items
 * @param {string | undefined} productKey
 */
function buildGroupedSelectOptions(items, productKey) {
  const pk = productKey?.trim()
  if (!pk) {
    return items.map((item) => ({
      value: item.id,
      label: formatActionItemOptionLabel(item),
      item,
    }))
  }

  const sameProduct = items.filter((item) => item.productKey?.trim() === pk)
  const others = items.filter((item) => item.productKey?.trim() !== pk)
  /** @type {import('antd/es/select').DefaultOptionType[]} */
  const groups = []

  if (sameProduct.length) {
    groups.push({
      label: '本产品',
      options: sameProduct.map((item) => ({
        value: item.id,
        label: formatActionItemOptionLabel(item),
        item,
      })),
    })
  }
  if (others.length) {
    groups.push({
      label: '全部举措',
      options: others.map((item) => ({
        value: item.id,
        label: formatActionItemOptionLabel(item),
        item,
      })),
    })
  }
  return groups
}

/**
 * @param {Object} props
 * @param {string | undefined} props.value - 当前 actionId
 * @param {string | undefined} [props.productKey] - 仅用于排序/分组，不作为 API 过滤
 * @param {(item: ActionItem) => void} props.onSelect
 * @param {() => void} [props.onClear]
 * @param {boolean} [props.disabled]
 */
export default function ActionItemSelect({ value, productKey, onSelect, onClear, disabled }) {
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState(/** @type {ActionItem[]} */ ([]))
  const [search, setSearch] = useState('')

  const loadOptions = useCallback(async (searchText = '') => {
    setLoading(true)
    try {
      const result = await listActionItems({
        search: searchText.trim() || undefined,
        limit: 80,
      })
      setOptions(filterAndSortActionItems(result.items, productKey))
    } catch {
      setOptions([])
    } finally {
      setLoading(false)
    }
  }, [productKey])

  useEffect(() => {
    loadOptions('')
  }, [loadOptions])

  useEffect(() => {
    if (!value?.trim()) return
    let cancelled = false
    ;(async () => {
      const exists = options.some((item) => item.id === value)
      if (exists) return
      const item = await getActionItem(value)
      if (!cancelled && item) {
        setOptions((prev) => {
          const merged = prev.some((p) => p.id === item.id) ? prev : [item, ...prev]
          return filterAndSortActionItems(merged, productKey)
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [value, options, productKey])

  const selectOptions = useMemo(
    () => buildGroupedSelectOptions(options, productKey),
    [options, productKey],
  )

  return (
    <Select
      showSearch
      allowClear
      disabled={disabled}
      placeholder="从举措库选择（可选）"
      className="w-full"
      value={value || undefined}
      filterOption={false}
      loading={loading}
      notFoundContent={loading ? <Spin size="small" /> : '暂无匹配举措'}
      options={selectOptions}
      optionRender={(option) => {
        const item = /** @type {ActionItem | undefined} */ (option.data?.item)
        if (!item) return option.label
        return renderActionItemOption(item)
      }}
      onSearch={(text) => {
        setSearch(text)
        loadOptions(text)
      }}
      onClear={() => {
        setSearch('')
        onClear?.()
        loadOptions('')
      }}
      onChange={async (nextValue) => {
        if (!nextValue) {
          onClear?.()
          return
        }
        if (EXCLUDED_SELECT_STATUSES.has(
          /** @type {ActionItem | undefined} */ (
            options.find((opt) => opt.id === nextValue)
          )?.status,
        )) {
          return
        }
        let item = options.find((opt) => opt.id === nextValue)
        if (!item) {
          item = await getActionItem(String(nextValue))
        }
        if (item && !EXCLUDED_SELECT_STATUSES.has(item.status)) onSelect(item)
      }}
      onOpenChange={(open) => {
        if (open && !search) loadOptions('')
      }}
    />
  )
}
