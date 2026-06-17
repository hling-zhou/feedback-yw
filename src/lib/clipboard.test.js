import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from './clipboard.js'

function mockDom({ execCommandResult = true } = {}) {
  const execCommand = vi.fn().mockReturnValue(execCommandResult)
  const textarea = {
    value: '',
    style: {},
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  }
  const body = {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  }
  vi.stubGlobal('document', {
    body,
    execCommand,
    createElement: vi.fn(() => textarea),
  })
  return { execCommand, textarea, body }
}

describe('copyTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false for empty text', async () => {
    expect(await copyTextToClipboard('')).toBe(false)
    expect(await copyTextToClipboard('   ')).toBe(false)
  })

  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    mockDom()

    const ok = await copyTextToClipboard('T-001')
    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('T-001')
  })

  it('falls back to execCommand when clipboard API fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { execCommand } = mockDom()

    const ok = await copyTextToClipboard('T-002\nT-003')
    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back when clipboard API is missing', async () => {
    vi.stubGlobal('navigator', {})
    const { execCommand } = mockDom()

    const ok = await copyTextToClipboard('REQ-001')
    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })
})
