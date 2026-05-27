import { DATA_SOURCE_TYPES } from '../../domain/enums.js'
import { isTicketSource } from '../importUtils.js'
import { yieldForHeavyTask, yieldToMain, yieldToNextFrame, yieldUntilIdle } from '../yieldToMain.js'

/**
 * @typedef {{ title: string; src: string }} ChartImage
 */

/** @type {Record<string, { selector: string; title: string }[]>} */
const CHART_TARGETS_BY_SCOPE = {
  overview: [
    { selector: '[data-pdf-chart="overview-wan-tou"]', title: '各产品万投比（投诉工单）' },
    { selector: '[data-pdf-chart="overview-trend"]', title: '跨源月度趋势' },
  ],
}

for (const type of DATA_SOURCE_TYPES) {
  if (isTicketSource(type)) {
    CHART_TARGETS_BY_SCOPE[type] = [
      { selector: '[data-pdf-chart="source-trend"]', title: '月度趋势' },
      { selector: '[data-pdf-chart="source-sentiment"]', title: '用户情绪分布' },
      { selector: '[data-pdf-chart="source-problems"]', title: '问题类型分布' },
      { selector: '[data-pdf-chart="source-journey"]', title: '用户旅程分布' },
    ]
  }
}

/** 截图缩放；过高易触发浏览器「页面无响应」 */
const CHART_CAPTURE_SCALE = 1.25
const YIELD_BETWEEN_CAPTURES_MS = 80

/**
 * 等待 Tab 切换后图表完成布局
 * @param {number} [ms]
 */
export function waitForChartsReady(ms = 650) {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setTimeout(resolve, ms))
    })
  })
}

/**
 * @param {string} scope
 * @param {HTMLElement | Document} [root]
 * @param {(info: { index: number; total: number; title: string }) => void} [onProgress]
 * @returns {Promise<ChartImage[]>}
 */
export async function captureChartsForScope(scope, root = document, onProgress) {
  const targets = CHART_TARGETS_BY_SCOPE[scope] || []
  if (!targets.length) return []

  const { default: html2canvas } = await import('html2canvas')
  /** @type {ChartImage[]} */
  const images = []

  const scopeRoot =
    root.querySelector?.('.ant-tabs-tabpane-active') ||
    root.querySelector?.('[role="tabpanel"][aria-hidden="false"]') ||
    root

  const total = targets.length

  for (let index = 0; index < targets.length; index += 1) {
    const { selector, title } = targets[index]
    onProgress?.({ index, total, title })
    await yieldForHeavyTask()

    const el = scopeRoot.querySelector(selector)
    if (!el || !(el instanceof HTMLElement)) continue
    try {
      await yieldUntilIdle(100)
      const canvas = await html2canvas(el, {
        scale: CHART_CAPTURE_SCALE,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        allowTaint: true,
        onclone: (doc) => {
          const cloned = doc.querySelector(selector)
          if (cloned instanceof HTMLElement) {
            cloned.style.background = '#fff'
          }
        },
      })
      images.push({ title, src: canvas.toDataURL('image/jpeg', 0.88) })
    } catch (err) {
      console.warn('[pdf] chart capture failed:', title, err)
    }
    await yieldToMain(YIELD_BETWEEN_CAPTURES_MS)
  }

  return images
}
