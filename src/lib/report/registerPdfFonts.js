import { Font } from '@react-pdf/renderer'
import notoRegularUrl from '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff?url'
import notoBoldUrl from '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff?url'

export const PDF_FONT_FAMILY = 'NotoSansSC'

let fontsReadyPromise = null

/**
 * @param {ArrayBuffer} buffer
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * @param {string} assetUrl
 */
async function fontAssetToDataUrl(assetUrl) {
  const href =
    assetUrl.startsWith('http') || assetUrl.startsWith('data:')
      ? assetUrl
      : new URL(assetUrl, window.location.origin).href
  const res = await fetch(href)
  if (!res.ok) {
    throw new Error(`PDF 字体加载失败 (${res.status}): ${href}`)
  }
  const buf = await res.arrayBuffer()
  const mime = assetUrl.endsWith('.woff2') ? 'font/woff2' : 'font/woff'
  return `data:${mime};base64,${arrayBufferToBase64(buf)}`
}

/**
 * 注册 PDF 中文字体（拉取本地 woff 并嵌入 base64，避免相对路径/CORS 导致乱码）
 * @returns {Promise<void>}
 */
export function ensurePdfFontsReady() {
  if (!fontsReadyPromise) {
    fontsReadyPromise = (async () => {
      const [regular, bold] = await Promise.all([
        fontAssetToDataUrl(notoRegularUrl),
        fontAssetToDataUrl(notoBoldUrl),
      ])
      Font.register({
        family: PDF_FONT_FAMILY,
        fonts: [
          { src: regular, fontWeight: 400, fontStyle: 'normal' },
          { src: bold, fontWeight: 700, fontStyle: 'normal' },
        ],
      })
    })()
  }
  return fontsReadyPromise
}

/** @deprecated 使用 ensurePdfFontsReady */
export function registerPdfFonts() {
  return ensurePdfFontsReady()
}
