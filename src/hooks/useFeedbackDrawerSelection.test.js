import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('useFeedbackDrawerSelection', () => {
  const src = readFileSync(
    resolve(import.meta.dirname, 'useFeedbackDrawerSelection.js'),
    'utf8',
  )

  it('confirms before switching to another ticket when drawer is dirty', () => {
    expect(src).toContain('drawerDirtyRef.current')
    expect(src).toContain('confirmDiscardFeedbackDrawerEdits')
    expect(src).toContain('current.id === next.id')
  })

  it('does not open confirm inside setState updater (StrictMode-safe)', () => {
    expect(src).not.toMatch(/setSelected\s*\(\s*\([^)]*\)\s*=>\s*\{[\s\S]*confirmDiscardFeedbackDrawerEdits/)
  })
})
