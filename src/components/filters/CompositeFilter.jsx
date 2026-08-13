import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, DatePicker, Dropdown, Input, Select, Tooltip, Typography } from 'antd'
import { CloseOutlined } from '@ant-design/icons'

/**
 * @typedef {'enum' | 'multiEnum' | 'dateRange' | 'multiSearch' | 'text'} CompositeFilterEditorKind
 */

/**
 * @template {string} TKey
 * @template {Record<string, unknown>} TValues
 * @typedef {Object} CompositeFilterConfig
 * @property {{ label: string; keys: TKey[] }[]} groups
 * @property {Record<TKey, string>} labels
 * @property {(key: TKey) => CompositeFilterEditorKind} getEditorKind
 * @property {(values: TValues) => TKey[]} listActiveChipKeys
 * @property {(values: TValues) => number} countActive
 * @property {(key: TKey, values: TValues) => string} formatChipLabel
 * @property {(key: TKey, values: TValues, ctx: unknown) => boolean} isAddDisabled
 * @property {(key: TKey, values: TValues, ctx: unknown) => string | undefined} [getAddDisabledReason]
 * @property {(key: TKey) => TKey} normalizeEditorKey
 * @property {(key: TKey, values: TValues) => unknown} readDraftValue
 * @property {(key: TKey, draft: unknown) => Partial<TValues>} buildPatchFromDraft
 * @property {(key: TKey, draft: unknown) => boolean} isDraftValid
 * @property {(key: TKey, patch: Partial<TValues>, current: TValues) => TValues} applyPatch
 * @property {(key: TKey, current: TValues) => TValues} clearKey
 * @property {(key: TKey, values: TValues, options: Record<string, unknown>) => { label: string; value: string; title?: string }[]} listEnumOptions
 * @property {(keys: TKey[]) => TKey[]} [filterMenuKeys]
 */

function compactFilterText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** Ant Design Select：忽略空格的 label 匹配（「弹性公网 IP」可命中「弹性公网IP」） */
function filterOptionIgnoreSpace(input, option) {
  const needle = compactFilterText(input)
  if (!needle) return true
  const label = compactFilterText(option?.label ?? option?.value)
  return label.includes(needle)
}

const POPUP_TO_BODY = () => document.body

/**
 * @template {string} TKey
 * @template {Record<string, unknown>} TValues
 * @param {Object} props
 * @param {TValues} props.filters
 * @param {(next: TValues, meta?: { key?: TKey; syncUrl?: boolean }) => void} props.onFiltersChange
 * @param {() => void} props.onClearFilters
 * @param {CompositeFilterConfig<TKey, TValues>} props.config
 * @param {unknown} [props.disableCtx]
 * @param {Record<string, unknown>} [props.options]
 * @param {string} [props.className]
 */
export default function CompositeFilter({
  filters,
  onFiltersChange,
  onClearFilters,
  config,
  disableCtx,
  options = {},
  className = '',
}) {
  const barRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [attributeOpen, setAttributeOpen] = useState(false)
  const [pendingKey, setPendingKey] = useState(/** @type {TKey | null} */ (null))
  const [specialDraft, setSpecialDraft] = useState(/** @type {unknown} */ (null))
  const [specialOpen, setSpecialOpen] = useState(false)

  const activeChipKeys = useMemo(() => config.listActiveChipKeys(filters), [config, filters])
  const activeCount = config.countActive(filters)

  const attributeMenuItems = useMemo(
    () =>
      config.groups.flatMap((group, groupIndex) => {
        const keys = config.filterMenuKeys ? config.filterMenuKeys(group.keys) : group.keys
        /** @type {import('antd').MenuProps['items']} */
        const groupItem = {
          type: 'group',
          label: group.label,
          key: `group-${group.label}`,
          children: keys.map((key) => {
            const disabled = config.isAddDisabled(key, filters, disableCtx)
            const disableReason = disabled
              ? config.getAddDisabledReason?.(key, filters, disableCtx)
              : undefined
            const labelText = config.labels[key]
            return {
              key,
              disabled,
              className: 'composite-filter-attribute-item',
              label:
                disabled && disableReason ? (
                  <AttributeMenuLabel reason={disableReason}>{labelText}</AttributeMenuLabel>
                ) : (
                  labelText
                ),
            }
          }),
        }
        if (groupIndex === 0) return [groupItem]
        return [{ type: 'divider', key: `divider-before-${group.label}` }, groupItem]
      }),
    [config, filters, disableCtx],
  )

  const resetPending = useCallback(() => {
    setPendingKey(null)
    setSpecialDraft(null)
    setSpecialOpen(false)
  }, [])

  const commitFilter = useCallback(
    (key, draft) => {
      const normalized = config.normalizeEditorKey(key)
      const patch = config.buildPatchFromDraft(normalized, draft)
      const next = config.applyPatch(normalized, patch, filters)
      onFiltersChange(next, { key: normalized, syncUrl: true })
      resetPending()
      setAttributeOpen(false)
    },
    [config, filters, onFiltersChange, resetPending],
  )

  const openSpecialEditor = (key) => {
    const normalized = config.normalizeEditorKey(key)
    setPendingKey(normalized)
    setSpecialDraft(config.readDraftValue(normalized, filters))
    setSpecialOpen(true)
  }

  const handleSelectAttribute = (key) => {
    const filterKey = /** @type {TKey} */ (key)
    const normalized = config.normalizeEditorKey(filterKey)
    setPendingKey(normalized)
    setAttributeOpen(false)
    const kind = config.getEditorKind(normalized)
    if (kind === 'enum') return
    openSpecialEditor(normalized)
  }

  const handleSelectEnumValue = (value) => {
    if (!pendingKey) return
    commitFilter(pendingKey, value)
  }

  const handleRemoveChip = (key) => {
    const next = config.clearKey(key, filters)
    onFiltersChange(next, { key, syncUrl: true })
    if (pendingKey === config.normalizeEditorKey(key)) resetPending()
  }

  const handleEditChip = (key) => {
    const normalized = config.normalizeEditorKey(key)
    setPendingKey(normalized)
    setAttributeOpen(false)
    const kind = config.getEditorKind(normalized)
    if (kind === 'enum') return
    openSpecialEditor(normalized)
  }

  const enumDropdownOpen = Boolean(
    pendingKey && config.getEditorKind(pendingKey) === 'enum',
  )

  const enumMenuItems = useMemo(() => {
    if (!pendingKey || config.getEditorKind(pendingKey) !== 'enum') return []
    return config.listEnumOptions(pendingKey, filters, options).map((item) => ({
      key: String(item.value),
      label: item.label,
      title: item.title,
    }))
  }, [pendingKey, config, filters, options])

  useEffect(() => {
    if (!enumDropdownOpen) return
    const timer = window.setTimeout(() => {
      barRef.current?.querySelector('[data-composite-value-anchor]')?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [enumDropdownOpen, pendingKey])

  const placeholder = activeCount > 0 ? '添加筛选条件' : '选择属性筛选'

  return (
    <div className={`relative ${className}`.trim()}>
      <div
        ref={barRef}
        className="flex min-h-[40px] flex-wrap items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-1.5 shadow-sm"
      >
        {activeChipKeys.map((key) => (
          <CompositeFilterChip
            key={key}
            label={config.labels[key]}
            value={config.formatChipLabel(key, filters)}
            onRemove={() => handleRemoveChip(key)}
            onEdit={() => handleEditChip(key)}
            active={pendingKey === config.normalizeEditorKey(key)}
          />
        ))}

        {pendingKey && config.getEditorKind(pendingKey) === 'enum' ? (
          <Dropdown
            open={enumDropdownOpen}
            onOpenChange={(open) => {
              if (!open) resetPending()
            }}
            menu={{
              items: enumMenuItems,
              onClick: ({ key }) => handleSelectEnumValue(key),
              style: { maxHeight: 280, overflow: 'auto' },
            }}
            trigger={['click']}
            getPopupContainer={POPUP_TO_BODY}
          >
            <button
              type="button"
              data-composite-value-anchor
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-sm text-primary hover:bg-indigo-50"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="text-ink-600">{config.labels[pendingKey]}:</span>
              <span className="text-ink-400">选择筛选值</span>
            </button>
          </Dropdown>
        ) : null}

        {!pendingKey ? (
          <Dropdown
            open={attributeOpen}
            onOpenChange={setAttributeOpen}
            menu={{
              items: attributeMenuItems,
              className: 'composite-filter-attribute-menu',
              onClick: ({ key }) => {
                if (String(key).startsWith('group-')) return
                handleSelectAttribute(key)
              },
              style: { maxHeight: 320, overflow: 'auto', minWidth: 200 },
            }}
            trigger={['click']}
            getPopupContainer={POPUP_TO_BODY}
          >
            <button
              type="button"
              className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-0.5 text-left text-sm text-ink-400 outline-none"
            >
              {placeholder}
            </button>
          </Dropdown>
        ) : config.getEditorKind(pendingKey) !== 'enum' ? (
          <span className="px-1 text-sm text-ink-500">{config.labels[pendingKey]}:</span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {activeCount > 0 ? (
            <Tooltip title="清除全部筛选条件">
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                onClick={(event) => {
                  event.stopPropagation()
                  resetPending()
                  onClearFilters()
                }}
              >
                <CloseOutlined className="text-xs" />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {pendingKey && config.getEditorKind(pendingKey) !== 'enum' ? (
        <SpecialFilterPopover
          open={specialOpen}
          anchorRef={barRef}
          label={config.labels[pendingKey]}
          filterKey={pendingKey}
          editorKind={config.getEditorKind(pendingKey)}
          draft={specialDraft}
          setDraft={setSpecialDraft}
          options={options}
          isDraftValid={config.isDraftValid}
          listEnumOptions={config.listEnumOptions}
          filters={filters}
          onClose={() => {
            setSpecialOpen(false)
            resetPending()
          }}
          onConfirm={() => {
            if (!pendingKey || !config.isDraftValid(pendingKey, specialDraft)) return
            commitFilter(pendingKey, specialDraft)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * @param {Object} props
 * @param {string} props.reason
 * @param {import('react').ReactNode} props.children
 */
function AttributeMenuLabel({ reason, children }) {
  return (
    <Tooltip
      title={reason}
      placement="right"
      mouseEnterDelay={0.15}
      getPopupContainer={POPUP_TO_BODY}
    >
      <span className="composite-filter-attribute-item-label block w-full cursor-not-allowed">
        {children}
      </span>
    </Tooltip>
  )
}

/**
 * @param {Object} props
 */
function CompositeFilterChip({ label, value, onRemove, onEdit, active }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-0.5 rounded border px-2 py-0.5 text-sm ${
        active ? 'border-primary bg-indigo-50' : 'border-ink-200 bg-ink-50'
      }`}
    >
      <button type="button" className="inline-flex min-w-0 items-center gap-0.5 text-left" onClick={onEdit}>
        <span className="shrink-0 text-ink-500">{label}:</span>
        <span className="truncate font-medium text-ink-800">{value}</span>
      </button>
      <button
        type="button"
        className="ml-0.5 shrink-0 text-ink-400 hover:text-ink-700"
        aria-label={`移除 ${label}`}
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
      >
        <CloseOutlined className="text-[10px]" />
      </button>
    </span>
  )
}

/**
 * @param {Object} props
 */
function SpecialFilterPopover({
  open,
  anchorRef,
  label,
  filterKey,
  editorKind,
  draft,
  setDraft,
  options,
  isDraftValid,
  listEnumOptions,
  filters,
  onClose,
  onConfirm,
}) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 360 })

  useLayoutEffect(() => {
    if (!open) return undefined
    const sync = () => {
      const rect = anchorRef?.current?.getBoundingClientRect()
      if (!rect) return
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.min(420, Math.max(280, rect.width)),
      })
    }
    sync()
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
    }
  }, [open, anchorRef])

  if (!open || typeof document === 'undefined') return null

  const enumOptions = listEnumOptions(filterKey, filters, options)

  return createPortal(
    <div
      className="rounded-lg border border-ink-200 bg-white p-3 shadow-lg"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 1100,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <Typography.Text strong className="mb-2 block text-sm">
        {label}
      </Typography.Text>
      {editorKind === 'multiSearch' || editorKind === 'multiEnum' ? (
        <Select
          mode="multiple"
          allowClear
          showSearch
          autoFocus
          className="w-full"
          placeholder={editorKind === 'multiSearch' ? '选择或搜索' : '选择一项或多项'}
          value={/** @type {string[]} */ (draft)}
          options={enumOptions}
          onChange={setDraft}
          optionFilterProp="label"
          filterOption={filterOptionIgnoreSpace}
          getPopupContainer={POPUP_TO_BODY}
        />
      ) : editorKind === 'dateRange' ? (
        <DatePicker.RangePicker
          allowEmpty={[true, true]}
          autoFocus
          className="w-full"
          placeholder={['起始日期', '结束日期']}
          value={/** @type {[import('dayjs').Dayjs | null, import('dayjs').Dayjs | null] | null} */ (
            draft
          )}
          onChange={(range) => setDraft(range ?? [null, null])}
          getPopupContainer={POPUP_TO_BODY}
        />
      ) : editorKind === 'text' ? (
        <Input
          allowClear
          autoFocus
          className="w-full"
          placeholder="输入关键字"
          value={/** @type {string} */ (draft ?? '')}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={() => {
            if (isDraftValid(filterKey, draft)) onConfirm()
          }}
        />
      ) : (
        <Input
          allowClear
          autoFocus
          className="w-full"
          placeholder="输入筛选值"
          value={/** @type {string} */ (draft ?? '')}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={() => {
            if (isDraftValid(filterKey, draft)) onConfirm()
          }}
        />
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="small" onClick={onClose}>
          取消
        </Button>
        <Button
          size="small"
          type="primary"
          disabled={!isDraftValid(filterKey, draft)}
          onClick={onConfirm}
        >
          确定
        </Button>
      </div>
    </div>,
    document.body,
  )
}
