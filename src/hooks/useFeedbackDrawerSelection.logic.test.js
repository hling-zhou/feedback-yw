import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('useFeedbackDrawerSelection leave-confirm wiring', () => {
  const hookSrc = readFileSync(
    resolve(import.meta.dirname, 'useFeedbackDrawerSelection.js'),
    'utf8',
  )
  const drawerSrc = readFileSync(
    resolve(import.meta.dirname, '../components/FeedbackDrawer.jsx'),
    'utf8',
  )

  it('confirms once in requestCloseDrawer and clears dirty before closeDrawer', () => {
    const requestCloseBlock = hookSrc.slice(
      hookSrc.indexOf('const requestCloseDrawer'),
      hookSrc.indexOf('const selectFeedback'),
    )
    expect(requestCloseBlock).toContain('confirmDiscardFeedbackDrawerEdits(() => {')
    expect(requestCloseBlock).toContain('drawerDirtyRef.current = false')
    expect(requestCloseBlock).toContain('closeDrawer()')
    expect(requestCloseBlock).not.toContain('confirmDiscardFeedbackDrawerEdits(closeDrawer)')
  })

  it('suppresses drawer close briefly after confirmed ticket switch', () => {
    expect(hookSrc).toContain('suppressCloseUntilRef')
    expect(hookSrc).toContain('Date.now() < suppressCloseUntilRef.current')
  })

  it('delegates drawer mask/close button to parent without a second confirm', () => {
    expect(drawerSrc).toContain('const handleRequestClose = useCallback(() => {')
    expect(drawerSrc).toContain('onClose()')
    expect(drawerSrc).not.toContain('confirmDiscardFeedbackDrawerEdits')
  })
})
