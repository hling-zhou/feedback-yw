import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, DatePicker, Dropdown, Input, Select, Tag, Tooltip, Typography } from 'antd'
import { CloseOutlined } from '@ant-design/icons'

const MULTI_SEARCH_TOKEN_SEPARATORS = [',', '\n', '\t', ' ']

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

function sameStringArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return left === right
  if (left.length !== right.length) return false
  const rightSet = new Set(right.map(String))
  return left.every((item) => rightSet.has(String(item)))
}

function renderOverflowTag(omittedValues) {
  const count = Array.isArray(omittedValues) ? omittedValues.length : 0
  return `+${count}`
}

function renderTruncatedSelectTag(props) {
  const { label, value, closable, onClose } = props
  const text = String(label ?? value ?? '')
  return (
    <Tag
      closable={closable}
      onClose={onClose}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      className="composite-filter-select-tag m-0 mr-1 inline-flex max-w-[10rem] items-center"
    >
      <Tooltip title={text}>
        <span className="block max-w-[8.5rem] truncate">{text}</span>
      </Tooltip>
    </Tag>
  )
}

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
 * @param {string} [props.emptyPlaceholder]
 * @param {string} [props.addPlaceholder]
 */
export default function CompositeFilter({
  filters,
  onFiltersChange,
  onClearFilters,
  config,
  disableCtx,
  options = {},
  className = '',
  emptyPlaceholder = '选择属性筛选（可搜索条件名）',
  addPlaceholder = '添加筛选条件',
}) {
  const barRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [attributeOpen, setAttributeOpen] = useState(false)
  const [attributeQuery, setAttributeQuery] = useState('')
  const [pendingKey, setPendingKey] = useState(/** @type {TKey | null} */ (null))
  const [specialDraft, setSpecialDraft] = useState(/** @type {unknown} */ (null))
  const [specialOpen, setSpecialOpen] = useState(false)
  const pendingKeyRef = useRef(pendingKey)
  pendingKeyRef.current = pendingKey

  const activeChipKeys = useMemo(() => config.listActiveChipKeys(filters), [config, filters])
  const activeCount = config.countActive(filters)
  const pendingNormalized = pendingKey ? config.normalizeEditorKey(pendingKey) : null
  const visibleChipKeys = pendingNormalized
    ? activeChipKeys.filter((key) => config.normalizeEditorKey(key) !== pendingNormalized)
    : activeChipKeys

  const attributeMenuItems = useMemo(() => {
    const needle = compactFilterText(attributeQuery)
    /** @type {import('antd').MenuProps['items']} */
    const items = []
    config.groups.forEach((group) => {
      const keys = (config.filterMenuKeys ? config.filterMenuKeys(group.keys) : group.keys).filter(
        (key) => !needle || compactFilterText(config.labels[key]).includes(needle),
      )
      if (!keys.length) return
      if (items.length) {
        items.push({ type: 'divider', key: `divider-before-${group.label}` })
      }
      items.push({
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
      })
    })
    return items
  }, [config, filters, disableCtx, attributeQuery])

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
    const key = pendingKeyRef.current
    if (!key) return
    commitFilter(key, value)
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

  const enumEditorOpen = Boolean(
    pendingKey && config.getEditorKind(pendingKey) === 'enum',
  )

  const enumSelectOptions = useMemo(() => {
    if (!pendingKey || config.getEditorKind(pendingKey) !== 'enum') return []
    return config.listEnumOptions(pendingKey, filters, options).map((item) => ({
      value: String(item.value),
      label: item.label,
      title: item.title,
    }))
  }, [pendingKey, config, filters, options])

  useEffect(() => {
    if (!enumEditorOpen) return
    const timer = window.setTimeout(() => {
      barRef.current?.querySelector('[data-composite-value-anchor]')?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [enumEditorOpen, pendingKey])

  const placeholder = activeCount > 0 ? addPlaceholder : emptyPlaceholder

  return (
    <div className={`relative ${className}`.trim()}>
      <div
        ref={barRef}
        className="flex min-h-[40px] flex-wrap items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-1.5 shadow-sm"
      >
        {visibleChipKeys.map((key) => (
          <CompositeFilterChip
            key={key}
            label={config.labels[key]}
            value={config.formatChipLabel(key, filters)}
            onRemove={() => handleRemoveChip(key)}
            onEdit={() => handleEditChip(key)}
            active={false}
          />
        ))}

        {enumEditorOpen && pendingKey ? (
          <div data-composite-value-anchor className="inline-flex min-w-[200px] max-w-[280px] items-center gap-1">
            <span className="shrink-0 text-sm text-ink-600">{config.labels[pendingKey]}:</span>
            <Select
              autoFocus
              defaultOpen
              showSearch
              allowClear={false}
              className="min-w-[140px] flex-1"
              placeholder="选择或搜索"
              options={enumSelectOptions}
              value={
                config.isAddDisabled(pendingKey, filters, disableCtx)
                  ? String(config.readDraftValue(pendingKey, filters) ?? '') || undefined
                  : undefined
              }
              filterOption={filterOptionIgnoreSpace}
              onChange={(value) => handleSelectEnumValue(value)}
              onOpenChange={(open) => {
                if (!open) resetPending()
              }}
              getPopupContainer={POPUP_TO_BODY}
            />
          </div>
        ) : null}

        {!pendingKey ? (
          <Dropdown
            open={attributeOpen}
            onOpenChange={(open) => {
              setAttributeOpen(open)
              if (!open) setAttributeQuery('')
            }}
            menu={{
              items: attributeMenuItems,
              className: 'composite-filter-attribute-menu',
              onClick: ({ key }) => {
                if (String(key).startsWith('group-') || String(key).startsWith('divider-')) return
                handleSelectAttribute(key)
              },
              style: { maxHeight: 280, overflow: 'auto', minWidth: 200 },
            }}
            trigger={['click']}
            getPopupContainer={POPUP_TO_BODY}
            popupRender={(menu) => (
              <div className="composite-filter-attribute-dropdown rounded-lg bg-white py-1 shadow-lg">
                <div className="px-2 pb-1 pt-1">
                  <Input
                    allowClear
                    autoFocus
                    placeholder="搜索筛选条件"
                    value={attributeQuery}
                    onChange={(event) => setAttributeQuery(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                </div>
                {attributeMenuItems.length ? (
                  menu
                ) : (
                  <div className="px-3 py-2 text-sm text-ink-400">无匹配条件</div>
                )}
              </div>
            )}
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
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded px-1.5 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-700"
              onClick={(event) => {
                event.stopPropagation()
                resetPending()
                onClearFilters()
              }}
            >
              <CloseOutlined className="text-[10px]" />
              清空
            </button>
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
          committedDraft={config.readDraftValue(pendingKey, filters)}
          setDraft={setSpecialDraft}
          options={options}
          isDraftValid={config.isDraftValid}
          listEnumOptions={config.listEnumOptions}
          filters={filters}
          onClose={resetPending}
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
  committedDraft,
  setDraft,
  options,
  isDraftValid,
  listEnumOptions,
  filters,
  onClose,
  onConfirm,
}) {
  const panelRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [pos, setPos] = useState({ top: 0, left: 0, width: 360 })
  const isMultiEditor = editorKind === 'multiSearch' || editorKind === 'multiEnum'
  const draftCount = Array.isArray(draft) ? draft.length : 0
  const showPendingHint =
    isMultiEditor && isDraftValid(filterKey, draft) && !sameStringArray(draft, committedDraft)

  useLayoutEffect(() => {
    if (!open) return undefined
    const sync = () => {
      const rect = anchorRef?.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(420, Math.max(280, rect.width))
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      const panelHeight = Math.max(panelRef.current?.offsetHeight || 0, 280)
      const below = rect.bottom + 4
      const fitsBelow = below + panelHeight <= window.innerHeight - 8
      const top = fitsBelow ? below : Math.max(8, rect.top - panelHeight - 4)
      setPos({ top, left, width })
    }
    sync()
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
    }
  }, [open, anchorRef, draft, editorKind])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      const panel = panelRef.current
      const target = event.target
      if (!panel || !(target instanceof Node) || panel.contains(target)) return
      onClose()
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  const getPopupContainer = () => panelRef.current || document.body

  if (!open || typeof document === 'undefined') return null

  const enumOptions = listEnumOptions(filterKey, filters, options)

  return createPortal(
    <div
      ref={panelRef}
      className="composite-filter-popover overflow-visible rounded-lg border border-ink-200 bg-white p-3 shadow-lg"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 1100,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <Typography.Text strong className="min-w-0 truncate text-sm">
          {label}
        </Typography.Text>
        <div className="flex shrink-0 items-center gap-2">
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
      </div>
      {isMultiEditor ? (
        <Select
          mode={editorKind === 'multiSearch' ? 'tags' : 'multiple'}
          allowClear
          showSearch
          autoFocus
          className="w-full"
          placeholder={editorKind === 'multiSearch' ? '搜索或粘贴，回车添加' : '选择一项或多项'}
          value={/** @type {string[]} */ (draft)}
          options={enumOptions}
          onChange={setDraft}
          optionFilterProp="label"
          filterOption={filterOptionIgnoreSpace}
          tokenSeparators={editorKind === 'multiSearch' ? MULTI_SEARCH_TOKEN_SEPARATORS : undefined}
          maxTagCount="responsive"
          maxTagPlaceholder={renderOverflowTag}
          tagRender={renderTruncatedSelectTag}
          popupMatchSelectWidth
          getPopupContainer={getPopupContainer}
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
          getPopupContainer={getPopupContainer}
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
      {showPendingHint ? (
        <Typography.Text type="secondary" className="mt-2 block text-xs">
          已选 {draftCount} 项，确定后生效
        </Typography.Text>
      ) : null}
    </div>,
    document.body,
  )
}
