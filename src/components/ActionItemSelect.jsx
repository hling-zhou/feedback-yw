import { useCallback, useEffect, useMemo, useState } from 'react'
import { Select, Spin, Tag, Typography } from 'antd'
import { ACTION_ITEM_STATUS_LABELS } from '../domain/actionItem.js'
import { formatActionItemOptionLabel } from '../domain/establishedActionLibrary.js'
import { listActionItems, getActionItem } from '../lib/actionItemClient.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */

/**
 * @param {Object} props
 * @param {string | undefined} props.value - 当前 actionId
 * @param {string | undefined} [props.productKey]
 * @param {(item: ActionItem) => void} props.onSelect
 * @param {() => void} [props.onClear]
 * @param {boolean} [props.disabled]
 */
export default function ActionItemSelect({ value, productKey, onSelect, onClear, disabled }) {
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState(/** @type {ActionItem[]} */ ([]))
  const [search, setSearch] = useState('')

  const loadOptions = useCallback(
    async (searchText = '') => {
      setLoading(true)
      try {
        const result = await listActionItems({
          productKey: productKey?.trim() || undefined,
          search: searchText.trim() || undefined,
          limit: 40,
        })
        setOptions(result.items)
      } catch {
        setOptions([])
      } finally {
        setLoading(false)
      }
    },
    [productKey],
  )

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
        setOptions((prev) => (prev.some((p) => p.id === item.id) ? prev : [item, ...prev]))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [value, options])

  const selectOptions = useMemo(
    () =>
      options.map((item) => ({
        value: item.id,
        label: formatActionItemOptionLabel(item),
        item,
      })),
    [options],
  )

  return (
    <div className="space-y-1">
      <Typography.Text type="secondary" className="text-xs">
        从举措库选择（可选）；选择后排期只读来自库内记录。
      </Typography.Text>
      <Select
        showSearch
        allowClear
        disabled={disabled}
        placeholder="搜索举措内容…"
        className="w-full"
        value={value || undefined}
        filterOption={false}
        loading={loading}
        notFoundContent={loading ? <Spin size="small" /> : '暂无匹配举措'}
        options={selectOptions.map((opt) => ({
          value: opt.value,
          label: opt.label,
          item: opt.item,
        }))}
        optionRender={(option) => {
          const item = /** @type {ActionItem | undefined} */ (option.data?.item)
          if (!item) return option.label
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
          if (item) onSelect(item)
        }}
        onOpenChange={(open) => {
          if (open && !search) loadOptions('')
        }}
      />
    </div>
  )
}
