import { describe, expect, it } from 'vitest'
import { appTheme } from './appTheme.js'

describe('appTheme', () => {
  it('aligns link tokens with brand primary', () => {
    expect(appTheme.token?.colorLink).toBe(appTheme.token?.colorPrimary)
    expect(appTheme.token?.colorLinkHover).toBeTruthy()
    expect(appTheme.token?.colorLinkActive).toBeTruthy()
  })

  it('sets underline tab gutter to 4px', () => {
    expect(appTheme.components?.Tabs?.horizontalItemGutter).toBe(4)
  })
})
