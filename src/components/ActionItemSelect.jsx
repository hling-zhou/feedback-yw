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
import { getEnabledProducts, getCatalogProduct } from '../lib/productCatalog.js'
import { getProductByKey } from '../lib/taxonomyLoader.js'
import { resolveProductKeyToCatalog } from '../lib/productCatalog/resolveProductKeyToCatalog.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */

/**
 * @param {ActionItem[]} items
 */
function filterSelectableActionItems(items) {
  return items.filter((item) => !isActionItemLocked(item.status))
}

/**
 * 产品下拉选项（11-18 归一后口径）：启用产品为主体；归一化后的 productKey 若不在
 * 启用清单（如 disabled 的用后即评产品，或未入目录的自定义产品），补一项保证默认
 * 选中值有对应选项——label 优先目录中文名（getCatalogProduct 含 disabled），再 taxonomy，最后 key。
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
  const pk = resolveProductKeyToCatalog(currentProductKey)
  if (pk && !map.has(pk)) {
    const catalogName = getCatalogProduct(pk)?.name?.trim()
    const taxonomyName = catalogName || getProductByKey(pk)?.name?.trim()
    map.set(pk, taxonomyName || pk)
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
 * @param {'ticket' | 'post_use' | 'api_patrol'} [props.source] - 举措来源过滤（ticket=投诉/咨询，post_use=用后即评，api_patrol=API巡检）
 * @param {(item: ActionItem) => void} props.onSelect
 * @param {() => void} [props.onClear]
 * @param {boolean} [props.disabled]
 */
export default function ActionItemSelect({ value, productKey, source, onSelect, onClear, disabled }) {
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState(/** @type {ActionItem[]} */ ([]))
  const [search, setSearch] = useState('')
  // 11-18 归一层：宿主传入可能是目录 key、中文名或规格名（溯源/回访传中文名），
  // 统一归一为目录 key 再进默认选中与查询通道。
  const [selectedProductKey, setSelectedProductKey] = useState(() => resolveProductKeyToCatalog(productKey))

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
          source,
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
    [selectedProductKey, source],
  )

  useEffect(() => {
    if (!value?.trim()) {
      setSelectedProductKey(resolveProductKeyToCatalog(productKey))
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
        // 11-18 归一层：存量 post_use 举措 product_key 可能是中文名——回填同样归一，
        // 已选条目本身由下方 merged 逻辑强制并入 options，不受查询过滤影响。
        setSelectedProductKey(resolveProductKeyToCatalog(item.productKey))
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
