import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('CompositeFilter special popover', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'CompositeFilter.jsx'), 'utf8')

  it('keeps select and date popups inside the popover panel', () => {
    expect(source).toContain('getPopupContainer = () => panelRef.current || document.body')
    expect(source).toContain("mode={editorKind === 'multiSearch' ? 'tags' : 'multiple'}")
    expect(source).toContain("placeholder={editorKind === 'multiSearch' ? '搜索或粘贴，回车添加'")
    expect(source).toContain("const MULTI_SEARCH_TOKEN_SEPARATORS = [',', '\\n', '\\t']")
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

  it('special popover anchors via bar rect + click-time offset snapshot, immune to trigger unmount (11-24: editor drifted to viewport top-left)', () => {
    // 11-24 根因（Playwright 真机取证，反馈库页）：属性按钮/被编辑 chip 在弹层打开的
    // 同一次 commit 里被卸载，持有元素引用后 getBoundingClientRect() 返回全零 →
    // 弹层定位到视口左上角 (8,4)，距触发元素 475px。修复：打开瞬间先快照触发元素
    // 相对 bar 的偏移（bar 始终在文档中），弹层定位 = bar 实时 rect + 快照偏移。
    // 11-18 遗留教训：document.activeElement 在菜单点击时实测是下拉面板里的搜索输入框
    // （随后也会被卸载），不可作为锚点——属性按钮必须用显式 ref。
    expect(source).toContain('captureAnchorOffset(anchorEl)')
    expect(source).toContain('anchorOffsetRef')
    expect(source).toContain('attributeTriggerRef')
    expect(source).toContain('barRect.left + offset.left')
    // 弹层定位不得持有可能已卸载的元素引用，代码中也不得把 document.activeElement 当锚点
    // （注释里的说明文字不算，只拦代码调用）
    expect(source).not.toMatch(/[(=]\s*document\.activeElement/)
    expect(source).not.toContain('specialAnchorRef')
    // 触发元素接线保留（chip 编辑按钮/属性按钮传入 openSpecialEditor）
    expect(source).toContain('openSpecialEditor(normalized, anchorEl)')
  })
})
