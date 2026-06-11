import { useCallback, useEffect, useMemo, useState } from 'react'
import { Select, Spin, Tag } from 'antd'
import { formatActionItemOptionLabel } from '../domain/establishedActionLibrary.js'
import { isActionItemLocked } from '../domain/actionItem.js'
import {
  formatDerivedRequirementStatusLabel,
  getActionItemDisplayScheduleAt,
  getActionItemDisplayStatus,
} from '../domain/requirementTicketProgress.js'
import { listActionItems, getActionItem } from '../lib/actionItemClient.js'
import ActionItemStatusTag from './tags/ActionItemStatusTag.jsx'
import { getEnabledProducts } from '../lib/productCatalog.js'
import { getProductByKey } from '../lib/taxonomyLoader.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */

/**
 * @param {ActionItem[]} items
 */
function filterSelectableActionItems(items) {
  return items.filter((item) => !isActionItemLocked(item.status))
}

/**
 * @param {string | undefined} currentProductKey
 */
function buildProductSelectOptions(currentProductKey) {
  /** @type {Map<string, string>} */
  const map = new Map()
  for (const product of getEnabledProducts()) {
    const key = product.key?.trim()
    if (!key) continue
    map.set(key, product.name?.trim() || key)
  }
  const pk = currentProductKey?.trim()
  if (pk && !map.has(pk)) {
    const taxonomy = getProductByKey(pk)
    map.set(pk, taxonomy?.name?.trim() || pk)
  }
  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

/**
 * @param {ActionItem} item
 */
function renderActionItemOption(item) {
  const displayStatus = getActionItemDisplayStatus(item)
  const displaySchedule = getActionItemDisplayScheduleAt(item)
  return (
    <div className="py-0.5">
      <div className="text-sm leading-snug">{item.content}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {displayStatus ? (
          <ActionItemStatusTag status={displayStatus} className="!mr-0" />
        ) : (
          <Tag color="warning" className="!mr-0">
            {formatDerivedRequirementStatusLabel(displayStatus)}
          </Tag>
        )}
        {displaySchedule ? (
          <Tag className="!mr-0">排期 {displaySchedule}</Tag>
        ) : (
          <Tag className="!mr-0">待评估</Tag>
        )}
      </div>
    </div>
  )
}

/**
 * @param {Object} props
 * @param {string | undefined} props.value - 当前 actionId
 * @param {string | undefined} [props.productKey] - 工单所属产品，作为产品级联默认选中
 * @param {(item: ActionItem) => void} props.onSelect
 * @param {() => void} [props.onClear]
 * @param {boolean} [props.disabled]
 */
export default function ActionItemSelect({ value, productKey, onSelect, onClear, disabled }) {
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState(/** @type {ActionItem[]} */ ([]))
  const [search, setSearch] = useState('')
  const [selectedProductKey, setSelectedProductKey] = useState(() => productKey?.trim() || '')

  const productOptions = useMemo(
    () => buildProductSelectOptions(productKey),
    [productKey],
  )

  const loadOptions = useCallback(
    async (searchText = '') => {
      const pk = selectedProductKey?.trim()
      if (!pk) {
        setOptions([])
        return
      }
      setLoading(true)
      try {
        const result = await listActionItems({
          productKey: pk,
          search: searchText.trim() || undefined,
          limit: 80,
        })
        setOptions(filterSelectableActionItems(result.items))
      } catch {
        setOptions([])
      } finally {
        setLoading(false)
      }
    },
    [selectedProductKey],
  )

  useEffect(() => {
    if (!value?.trim()) {
      setSelectedProductKey(productKey?.trim() || '')
    }
  }, [productKey, value])

  useEffect(() => {
    loadOptions('')
  }, [loadOptions])

  useEffect(() => {
    if (!value?.trim()) return
    let cancelled = false
    ;(async () => {
      const item = await getActionItem(value)
      if (cancelled || !item) return
      if (item.productKey?.trim()) {
        setSelectedProductKey(item.productKey.trim())
      }
      setOptions((prev) => {
        if (isActionItemLocked(item.status)) return prev
        const merged = prev.some((p) => p.id === item.id) ? prev : [item, ...prev]
        return filterSelectableActionItems(merged)
      })
    })()
    return () => {
      cancelled = true
    }
  }, [value])

  const actionSelectOptions = useMemo(
    () =>
      options.map((item) => ({
        value: item.id,
        label: formatActionItemOptionLabel(item),
        item,
      })),
    [options],
  )

  const handleProductChange = (nextProductKey) => {
    const pk = String(nextProductKey || '').trim()
    setSelectedProductKey(pk)
    setSearch('')
    if (value?.trim()) {
      onClear?.()
    }
  }

  return (
    <div className="flex w-full gap-2">
      <Select
        disabled={disabled}
        placeholder="产品"
        className="min-w-0 flex-[2]"
        value={selectedProductKey || undefined}
        options={productOptions}
        onChange={handleProductChange}
      />
      <Select
        showSearch
        allowClear
        disabled={disabled || !selectedProductKey}
        placeholder="举措"
        className="min-w-0 flex-[3]"
        value={value || undefined}
        filterOption={false}
        loading={loading}
        notFoundContent={loading ? <Spin size="small" /> : '暂无匹配举措'}
        options={actionSelectOptions}
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
          let item = options.find((opt) => opt.id === nextValue)
          if (!item) {
            item = await getActionItem(String(nextValue))
          }
          if (item && !isActionItemLocked(item.status)) onSelect(item)
        }}
        onOpenChange={(open) => {
          if (open && !search) loadOptions('')
        }}
      />
    </div>
  )
}
