import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from './clipboard.js'

function mockDom({ execCommandResult = true, activeHost = null } = {}) {
  const execCommand = vi.fn().mockReturnValue(execCommandResult)
  const textarea = {
    value: '',
    style: {},
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  }
  const body = {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  }
  const host = activeHost || body
  if (!host.appendChild) host.appendChild = vi.fn()
  if (!host.removeChild) host.removeChild = vi.fn()

  const activeElement = activeHost
    ? { closest: vi.fn((selector) => (String(selector).includes('.ant-modal') ? activeHost : null)) }
    : null

  vi.stubGlobal('document', {
    body,
    activeElement,
    execCommand,
    createElement: vi.fn(() => textarea),
  })
  return { execCommand, textarea, body, host, activeElement }
}

describe('copyTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false for empty text', async () => {
    expect(await copyTextToClipboard('')).toBe(false)
    expect(await copyTextToClipboard('   ')).toBe(false)
  })

  it('uses navigator.clipboard in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    mockDom()

    const ok = await copyTextToClipboard('T-001')
    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('T-001')
  })

  it('skips clipboard API in insecure context and uses execCommand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { isSecureContext: false })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { execCommand } = mockDom()

    const ok = await copyTextToClipboard('T-HTTP')
    expect(ok).toBe(true)
    expect(writeText).not.toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back to execCommand when clipboard API fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { execCommand } = mockDom()

    const ok = await copyTextToClipboard('T-002\nT-003')
    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back when clipboard API is missing', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', {})
    const { execCommand } = mockDom()

    const ok = await copyTextToClipboard('REQ-001')
    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('appends the helper textarea inside the open modal, not document.body', async () => {
    vi.stubGlobal('window', { isSecureContext: false })
    vi.stubGlobal('navigator', {})
    const modal = { appendChild: vi.fn(), removeChild: vi.fn() }
    const { body, textarea } = mockDom({ activeHost: modal })

    const ok = await copyTextToClipboard('全文内容')
    expect(ok).toBe(true)
    expect(modal.appendChild).toHaveBeenCalledWith(textarea)
    expect(modal.removeChild).toHaveBeenCalledWith(textarea)
    expect(body.appendChild).not.toHaveBeenCalled()
  })

  it('uses an explicit container when provided', async () => {
    vi.stubGlobal('window', { isSecureContext: false })
    vi.stubGlobal('navigator', {})
    const { body, textarea } = mockDom()
    const container = { appendChild: vi.fn(), removeChild: vi.fn() }

    const ok = await copyTextToClipboard('工单原文', { container })
    expect(ok).toBe(true)
    expect(container.appendChild).toHaveBeenCalledWith(textarea)
    expect(container.removeChild).toHaveBeenCalledWith(textarea)
    expect(body.appendChild).not.toHaveBeenCalled()
  })
})
