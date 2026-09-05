/**
 * 复制文本到剪贴板。
 *
 * 先同步 execCommand（保住点击手势，并在 Modal/Drawer 焦点陷阱内写入），
 * 再尝试 Clipboard API。任一成功即视为成功。
 * 仅在安全上下文使用 Clipboard API，避免 HTTP 内网 / WebView 假成功。
 *
 * @param {string} text
 * @param {{ container?: Element | null }} [options]
 * @returns {Promise<boolean>}
 */
export async function copyTextToClipboard(text, options = {}) {
  const value = String(text ?? '').trim()
  if (!value) return false

  const legacyOk = copyWithLegacyCommand(value, options.container)

  if (canUseClipboardApi()) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      /* use legacy result */
    }
  }

  return legacyOk
}

function canUseClipboardApi() {
  return Boolean(
    typeof window !== 'undefined' &&
      window.isSecureContext &&
      navigator.clipboard?.writeText,
  )
}

function resolveCopyHost() {
  const active = typeof document !== 'undefined' ? document.activeElement : null
  if (active && typeof active.closest === 'function') {
    const host = active.closest(
      '.ant-modal, [role="dialog"], .ant-drawer-content, .ant-popover-content',
    )
    if (host) return host
  }
  return document.body
}

/**
 * @param {string} value
 * @param {Element | null} [container]
 * @returns {boolean}
 */
function copyWithLegacyCommand(value, container) {
  try {
    const host = container || resolveCopyHost()
    if (!host || typeof document.execCommand !== 'function') return false

    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.setAttribute('tabindex', '-1')
    textarea.setAttribute('aria-hidden', 'true')
    // 必须留在视口内：left:-9999px 在部分浏览器会选中失败但仍返回 true
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '0'
    textarea.style.width = '1px'
    textarea.style.height = '1px'
    textarea.style.padding = '0'
    textarea.style.margin = '0'
    textarea.style.border = 'none'
    textarea.style.outline = 'none'
    textarea.style.boxShadow = 'none'
    textarea.style.background = 'transparent'
    textarea.style.opacity = '0.01'
    textarea.style.color = 'transparent'
    textarea.style.zIndex = '2147483647'
    textarea.style.pointerEvents = 'none'

    host.appendChild(textarea)
    const previous = document.activeElement
    textarea.focus?.({ preventScroll: true })
    textarea.select?.()
    textarea.setSelectionRange?.(0, value.length)

    const ok = document.execCommand('copy')

    host.removeChild(textarea)
    if (previous && previous !== textarea && typeof previous.focus === 'function') {
      try {
        previous.focus({ preventScroll: true })
      } catch {
        /* ignore */
      }
    }
    return Boolean(ok)
  } catch {
    return false
  }
}
