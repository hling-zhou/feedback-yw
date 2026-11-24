import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CompositeFilter from './CompositeFilter.jsx'

/**
 * 共享复合筛选真渲染冒烟（11-24 随弹层锚定修复补齐）。
 * CompositeFilter 是 6 个复合搜索宿主（反馈库/用后即评/行动/工单待办/主题/巡检失败）
 * 的共享底座——挂载即炸直接红。弹层定位属纯视觉行为（useLayoutEffect SSR 不执行），
 * 由 Playwright 真机验证兜底；此冒烟锁定「能编译、能渲染、chip/清空接线在」。
 */

const LABELS = { requestId: 'RequestID', status: '状态' }

const config = {
  groups: [
    { label: '文本搜索', keys: ['requestId'] },
    { label: '属性筛选', keys: ['status'] },
  ],
  labels: LABELS,
  getEditorKind: (key) => (key === 'status' ? 'enum' : 'text'),
  listActiveChipKeys: (values) =>
    Object.keys(LABELS).filter((k) => String(values[k] || '').trim() !== ''),
  countActive: (values) =>
    Object.keys(LABELS).filter((k) => String(values[k] || '').trim() !== '').length,
  formatChipLabel: (key, values) => String(values[key] || ''),
  isAddDisabled: () => false,
  normalizeEditorKey: (key) => key,
  readDraftValue: (key, values) => values[key] || '',
  buildPatchFromDraft: (key, draft) => ({ [key]: String(draft || '').trim() }),
  isDraftValid: (key, draft) => String(draft || '').trim() !== '',
  applyPatch: (key, patch, current) => ({ ...current, ...patch }),
  clearKey: (key, current) => {
    const next = { ...current }
    delete next[key]
    return next
  },
  listEnumOptions: () => [],
}

const renderBar = (filters) =>
  renderToStaticMarkup(
    <CompositeFilter
      filters={filters}
      onFiltersChange={() => {}}
      onClearFilters={() => {}}
      config={config}
    />,
  )

describe('CompositeFilter 真渲染冒烟', () => {
  it('空筛选渲染属性按钮 placeholder，无 chip 无清空', () => {
    const html = renderBar({})
    expect(html).toContain('选择属性筛选（可搜索条件名）')
    expect(html).not.toContain('RequestID:')
    expect(html).not.toContain('清空')
  })

  it('有筛选值渲染 chip 与清空按钮', () => {
    const html = renderBar({ requestId: 'abc-123' })
    expect(html).toContain('RequestID:')
    expect(html).toContain('abc-123')
    expect(html).toContain('清空')
  })
})
