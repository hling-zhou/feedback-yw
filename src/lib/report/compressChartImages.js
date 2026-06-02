import { isMostlyBlankCanvas } from './captureChartImages.js'
import { yieldToMain, yieldToNextFrame } from '../yieldToMain.js'

const PDF_CHART_MAX_WIDTH = 1100
const PDF_CHART_JPEG_QUALITY = 0.86

/**
 * 缩小图表截图，减轻 @react-pdf toBlob 主线程阻塞，降低「页面无响应」概率。
 * @param {import('./captureChartImages.js').ChartImage[]} images
 * @returns {Promise<import('./captureChartImages.js').ChartImage[]>}
 */
export async function compressChartImagesForPdf(images) {
  if (!images.length || typeof document === 'undefined') return images

  /** @type {import('./captureChartImages.js').ChartImage[]} */
  const out = []

  for (const img of images) {
    await yieldToNextFrame()
    try {
      const compressed = await compressOneChartImage(img.src)
      out.push({ title: img.title, src: compressed })
    } catch {
      out.push(img)
    }
    await yieldToMain(24)
  }

  return out
}

/**
 * @param {string} dataUrl
 * @returns {Promise<string>}
 */
function compressOneChartImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, PDF_CHART_MAX_WIDTH / Math.max(image.width, 1))
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas 2d unavailable'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(image, 0, 0, width, height)
      if (isMostlyBlankCanvas(canvas)) {
        reject(new Error('compressed chart image is blank'))
        return
      }
      const mime = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
      const quality = mime === 'image/png' ? undefined : PDF_CHART_JPEG_QUALITY
      resolve(canvas.toDataURL(mime, quality))
    }
    image.onerror = () => reject(new Error('chart image decode failed'))
    image.src = dataUrl
  })
}
