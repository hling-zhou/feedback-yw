import { useCallback, useEffect, useMemo, useState } from 'react'
import { Select, Spin, Tag } from 'antd'
import { listTicketTodos } from '../lib/ticketTodoClient.js'
import {
  formatTicketTodoAssigneeLabel,
  isTicketTodoOpen,
  normalizeTicketTodoLinkedTicketIds,
} from '../domain/ticketTodo.js'
import TicketTodoStatusTag from './tags/TicketTodoStatusTag.jsx'
import { getEnabledProducts } from '../lib/productCatalog.js'
import { getProductByKey } from '../lib/taxonomyLoader.js'

/** @typedef {import('../domain/ticketTodo.js').TicketTodoRow} TicketTodoRow */

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
 * @param {TicketTodoRow} row
 * @param {string} currentTicketId
 * @param {string} currentRecordId
 */
export function isTicketTodoSelectableForRecord(row, currentTicketId, currentRecordId) {
  if (!isTicketTodoOpen(row)) return false
  if (row.recordId && row.recordId === currentRecordId) return false
  const linked = normalizeTicketTodoLinkedTicketIds(row, row.ticketId)
  if (currentTicketId && linked.includes(currentTicketId)) return false
  return true
}

/**
 * @param {Object} props
 * @param {string} [props.productKey]
 * @param {string} [props.currentTicketId]
 * @param {string} [props.currentRecordId]
 * @param {(row: TicketTodoRow) => void} props.onSelect
 * @param {boolean} [props.disabled]
 */
export default function TicketTodoSelect({
  productKey,
  currentTicketId,
  currentRecordId,
  onSelect,
  disabled,
}) {
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState(/** @type {TicketTodoRow[]} */ ([]))
  const [search, setSearch] = useState('')
  const [selectedProductKey, setSelectedProductKey] = useState(() => productKey?.trim() || '')

  const productOptions = useMemo(() => buildProductSelectOptions(productKey), [productKey])

  const loadOptions = useCallback(
    async (searchText = '') => {
      setLoading(true)
      try {
        const result = await listTicketTodos({
          productKey: selectedProductKey.trim() || undefined,
          status: 'open',
          search: searchText.trim() || undefined,
          limit: 80,
        })
        const items = (result.items || []).filter((row) =>
          isTicketTodoSelectableForRecord(row, currentTicketId || '', currentRecordId || ''),
        )
        setOptions(items)
      } catch {
        setOptions([])
      } finally {
        setLoading(false)
      }
    },
    [selectedProductKey, currentTicketId, currentRecordId],
  )

  useEffect(() => {
    setSelectedProductKey(productKey?.trim() || '')
  }, [productKey])

  useEffect(() => {
    void loadOptions('')
  }, [loadOptions])

  const selectOptions = useMemo(
    () =>
      options.map((item) => ({
        value: item.id,
        label: item.text,
        item,
      })),
    [options],
  )

  return (
    <div className="flex w-full gap-2">
      <Select
        disabled={disabled}
        placeholder="产品"
        className="min-w-0 flex-[2]"
        allowClear
        value={selectedProductKey || undefined}
        options={productOptions}
        onChange={(next) => {
          setSelectedProductKey(String(next || '').trim())
          setSearch('')
        }}
      />
      <Select
        showSearch
        allowClear
        disabled={disabled}
        placeholder="关联已有待办"
        className="min-w-0 flex-[3]"
        value={undefined}
        filterOption={false}
        loading={loading}
        notFoundContent={loading ? <Spin size="small" /> : '暂无未处理待办'}
        options={selectOptions}
        optionRender={(option) => {
          const item = /** @type {TicketTodoRow | undefined} */ (option.data?.item)
          if (!item) return option.label
          return (
            <div className="py-0.5">
              <div className="text-sm leading-snug">{item.text}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <TicketTodoStatusTag resolution={item.resolution} className="!mr-0" />
                {item.ticketId ? <Tag className="!mr-0">{item.ticketId}</Tag> : null}
                <Tag className="!mr-0">{formatTicketTodoAssigneeLabel(item)}</Tag>
              </div>
            </div>
          )
        }}
        onSearch={(text) => {
          setSearch(text)
          void loadOptions(text)
        }}
        onClear={() => {
          setSearch('')
          void loadOptions('')
        }}
        onChange={(nextValue) => {
          if (!nextValue) return
          const item = options.find((row) => row.id === nextValue)
          if (item) onSelect(item)
        }}
        onOpenChange={(open) => {
          if (open && !search) void loadOptions('')
        }}
      />
    </div>
  )
}
