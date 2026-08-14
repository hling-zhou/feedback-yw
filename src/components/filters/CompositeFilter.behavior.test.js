import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('CompositeFilter special popover', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'CompositeFilter.jsx'), 'utf8')

  it('keeps select and date popups inside the popover panel', () => {
    expect(source).toContain('getPopupContainer = () => panelRef.current || document.body')
    expect(source).toContain("mode={editorKind === 'multiSearch' ? 'tags' : 'multiple'}")
    expect(source).toContain("placeholder={editorKind === 'multiSearch' ? '搜索或粘贴，回车添加'")
    expect(source).toContain('maxTagCount="responsive"')
    expect(source).toContain('已选 {draftCount} 项，确定后生效')
    expect(source).toContain("event.key !== 'Escape'")
    expect(source).toContain("document.addEventListener('pointerdown', onPointerDown, true)")
  })

  it('supports searchable enums, attribute search, clear label, and viewport flip', () => {
    expect(source).toContain('placeholder="选择或搜索"')
    expect(source).toContain('placeholder="搜索筛选条件"')
    expect(source).toContain('visibleChipKeys')
    expect(source).toContain('清空')
    expect(source).toContain('fitsBelow')
  })
})
