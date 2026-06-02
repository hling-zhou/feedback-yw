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
    { selector: '[data-pdf-chart="overview-trend"]', title: '跨源月度趋势（工单类合计）' },
  ],
  post_use_rating: [
    { selector: '[data-pdf-chart="yhjp-product-scores"]', title: '各产品评分（周期内）' },
  ],
}

const TICKET_CHART_TARGETS = [
  { selector: '[data-pdf-chart="source-trend"]', title: '月度趋势' },
  { selector: '[data-pdf-chart="source-sentiment"]', title: '客户情绪分布' },
  { selector: '[data-pdf-chart="source-experience"]', title: '体验断点分析' },
  { selector: '[data-pdf-chart="source-journey"]', title: '按旅程环节聚合反馈' },
  { selector: '[data-pdf-chart="source-request-scenes"]', title: '请求场景分布' },
  { selector: '[data-pdf-chart="source-problems"]', title: '问题类型（打标）分布' },
]

const COMPLAINT_ONLY_CHART_TARGETS = [
  { selector: '[data-pdf-chart="source-complaint-cause"]', title: '投诉原因（终判）分布' },
]

for (const type of DATA_SOURCE_TYPES) {
  if (isTicketSource(type)) {
    CHART_TARGETS_BY_SCOPE[type] =
      type === 'complaint_ticket'
        ? [...TICKET_CHART_TARGETS, ...COMPLAINT_ONLY_CHART_TARGETS]
        : [...TICKET_CHART_TARGETS]
  }
}

/** 截图缩放；过高易触发浏览器「页面无响应」 */
const CHART_CAPTURE_SCALE = 1.5
const YIELD_BETWEEN_CAPTURES_MS = 80
const CHART_MIN_HEIGHT_PX = 8
const CHART_MIN_WIDTH_PX = 40
const PDF_CAPTURE_ROOT_WIDTH_PX = 1280

/**
 * 触发 Recharts ResponsiveContainer 在离屏容器中重新测量尺寸
 */
export function nudgeChartLayout() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('resize'))
}

/**
 * 离屏 PDF 截图容器必须可绘制：opacity:0 / z-index:-1 会导致 html2canvas 产出黑块
 * @param {HTMLElement | null | undefined} root
 */
export function preparePdfCaptureRoot(root) {
  if (!(root instanceof HTMLElement)) return
  Object.assign(root.style, {
    position: 'fixed',
    left: '-12000px',
    top: '0',
    width: `${PDF_CAPTURE_ROOT_WIDTH_PX}px`,
    opacity: '1',
    visibility: 'visible',
    pointerEvents: 'none',
    zIndex: '1',
    overflow: 'visible',
    background: '#ffffff',
  })
  nudgeChartLayout()
}

/**
 * @param {HTMLCanvasElement} canvas
 */
export function isMostlyBlankCanvas(canvas) {
  const ctx = canvas.getContext('2d')
  if (!ctx || canvas.width < 4 || canvas.height < 4) return true

  const points = [
    [Math.floor(canvas.width * 0.25), Math.floor(canvas.height * 0.25)],
    [Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.5)],
    [Math.floor(canvas.width * 0.75), Math.floor(canvas.height * 0.75)],
    [Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.2)],
    [Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.8)],
  ]

  let dark = 0
  let colored = 0
  for (const [x, y] of points) {
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
    if (a < 12) continue
    if (r < 28 && g < 28 && b < 28) {
      dark += 1
      continue
    }
    if (Math.abs(r - g) > 8 || Math.abs(g - b) > 8 || r < 240 || g < 240 || b < 240) {
      colored += 1
    }
  }

  if (colored >= 1) return false
  return dark >= 2
}

/**
 * @param {HTMLElement} el
 */
function hasRenderedChartSurface(el) {
  const surface = el.querySelector('.recharts-surface')
  if (!(surface instanceof SVGElement)) return true
  const width =
    Number(surface.getAttribute('width')) || surface.getBoundingClientRect().width
  const height =
    Number(surface.getAttribute('height')) || surface.getBoundingClientRect().height
  return width >= CHART_MIN_WIDTH_PX && height >= CHART_MIN_HEIGHT_PX
}

/**
 * @param {HTMLElement | Document} tabRoot
 * @param {string} selector
 */
function isChartTargetReady(tabRoot, selector) {
  const el = tabRoot.querySelector(selector)
  if (!(el instanceof HTMLElement)) return false
  const { height, width } = el.getBoundingClientRect()
  if (height < CHART_MIN_HEIGHT_PX || width < CHART_MIN_WIDTH_PX) return false
  return hasRenderedChartSurface(el)
}

/**
 * @param {string} scope
 * @returns {{ selector: string; title: string }[]}
 */
export function chartTargetsForScope(scope) {
  return CHART_TARGETS_BY_SCOPE[scope] || []
}

/**
 * @param {string} scope
 * @param {HTMLElement | Document} [root]
 * @returns {HTMLElement | Document}
 */
export function resolveWorkbenchTabRoot(scope, root = document) {
  const tab = scope === 'overview' ? 'overview' : scope
  const host = root instanceof HTMLElement || root instanceof Document ? root : document
  const tabRoot = host.querySelector?.(`[data-workbench-tab="${tab}"]`)
  if (tabRoot instanceof HTMLElement) return tabRoot
  const workbench = host.querySelector?.('#insight-workbench-root')
  if (workbench instanceof HTMLElement) return workbench
  return host instanceof HTMLElement ? host : document.body
}

/**
 * 等待 Tab 切换后图表完成布局
 * @param {number} [ms]
 */
export function waitForChartsReady(ms = 650) {
  return new Promise((resolve) => {
    nudgeChartLayout()
    requestAnimationFrame(() => {
      nudgeChartLayout()
      requestAnimationFrame(() => setTimeout(resolve, ms))
    })
  })
}

/**
 * @param {HTMLElement | Document} tabRoot
 * @param {string} selector
 */
function chartTargetExists(tabRoot, selector) {
  return tabRoot.querySelector(selector) instanceof HTMLElement
}

/**
 * @param {HTMLElement | Document} tabRoot
 * @param {{ selector: string; title: string }[]} targets
 */
function chartTargetsPresentInDom(tabRoot, targets) {
  return targets.filter(({ selector }) => chartTargetExists(tabRoot, selector))
}

/**
 * 切换工作台 Tab 后等待对应图表节点挂载并完成绘制
 * @param {string} scope
 * @param {HTMLElement | Document} [root]
 * @param {{ timeoutMs?: number; renderMs?: number }} [options]
 * @returns {Promise<{ selector: string; title: string }[]>}
 */
export async function waitForWorkbenchCharts(scope, root = document, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000
  const renderMs = options.renderMs ?? 900
  const targets = chartTargetsForScope(scope)
  if (!targets.length) return []

  const tabRoot = resolveWorkbenchTabRoot(scope, root)
  if (root instanceof HTMLElement) preparePdfCaptureRoot(root)

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const presentTargets = chartTargetsPresentInDom(tabRoot, targets)
    if (!presentTargets.length) {
      await yieldToMain(150)
      continue
    }
    const readyTargets = presentTargets.filter(({ selector }) =>
      isChartTargetReady(tabRoot, selector),
    )
    if (readyTargets.length === presentTargets.length) break
    await yieldToMain(150)
  }

  nudgeChartLayout()
  await waitForChartsReady(renderMs)

  return targets.filter(({ selector }) => isChartTargetReady(tabRoot, selector))
}

/**
 * @param {HTMLElement} root
 */
function patchClonedChartSubtree(root) {
  root.style.background = '#ffffff'
  root.style.opacity = '1'
  root.style.visibility = 'visible'
  root.style.color = '#111827'

  root.querySelectorAll('svg.recharts-surface, svg').forEach((svg) => {
    if (!(svg instanceof SVGElement)) return
    svg.style.overflow = 'visible'
    svg.querySelectorAll('*').forEach((node) => {
      if (!(node instanceof SVGElement)) return
      if (node.getAttribute('fill') === 'currentColor') {
        node.setAttribute('fill', '#374151')
      }
      if (node.getAttribute('stroke') === 'currentColor') {
        node.setAttribute('stroke', '#374151')
      }
    })
  })
}

/**
 * @param {HTMLElement} el
 * @returns {Promise<string | null>}
 */
async function captureRechartsSvgFallback(el) {
  const svg = el.querySelector('svg.recharts-surface')
  if (!(svg instanceof SVGSVGElement)) return null

  const rect = svg.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const clone = /** @type {SVGSVGElement} */ (svg.cloneNode(true))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const xml = new XMLSerializer().serializeToString(clone)
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
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
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('svg rasterize failed'))
    image.src = svgUrl
  })
}

/**
 * @param {HTMLElement} el
 * @param {string} chartKey
 * @param {HTMLElement | null} captureRoot
 */
async function captureElementToImage(el, chartKey, captureRoot) {
  const { default: html2canvas } = await import('html2canvas')
  if (captureRoot) preparePdfCaptureRoot(captureRoot)
  nudgeChartLayout()
  await yieldToNextFrame()
  await yieldUntilIdle(160)

  const rect = el.getBoundingClientRect()
  const html2canvasOptions = {
    scale: CHART_CAPTURE_SCALE,
    backgroundColor: '#ffffff',
    logging: false,
    useCORS: true,
    allowTaint: false,
    foreignObjectRendering: false,
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
    scrollX: 0,
    scrollY: 0,
    onclone: (doc, clonedEl) => {
      const cloned =
        clonedEl instanceof HTMLElement
          ? clonedEl
          : doc.querySelector(`[data-pdf-chart="${chartKey}"]`)
      if (cloned instanceof HTMLElement) patchClonedChartSubtree(cloned)
    },
  }

  let canvas = await html2canvas(el, html2canvasOptions)
  if (isMostlyBlankCanvas(canvas)) {
    canvas = await html2canvas(el, {
      ...html2canvasOptions,
      scale: 1,
      foreignObjectRendering: false,
    })
  }

  if (!isMostlyBlankCanvas(canvas)) {
    return canvas.toDataURL('image/png')
  }

  const svgFallback = await captureRechartsSvgFallback(el)
  if (svgFallback) return svgFallback

  console.warn('[pdf] chart capture produced blank canvas:', chartKey)
  return canvas.toDataURL('image/png')
}

/**
 * @param {string} selector
 */
function chartKeyFromSelector(selector) {
  const matched = selector.match(/data-pdf-chart="([^"]+)"/)
  return matched?.[1] || selector
}

/**
 * @param {string} scope
 * @param {HTMLElement | Document} [root]
 * @param {(info: { index: number; total: number; title: string }) => void} [onProgress]
 * @returns {Promise<ChartImage[]>}
 */
export async function captureChartsForScope(scope, root = document, onProgress) {
  const targets = chartTargetsForScope(scope)
  if (!targets.length) return []

  const captureRoot = root instanceof HTMLElement ? root : null
  if (captureRoot) preparePdfCaptureRoot(captureRoot)

  const tabRoot = resolveWorkbenchTabRoot(scope, root)
  /** @type {ChartImage[]} */
  const images = []
  const total = targets.length

  for (let index = 0; index < targets.length; index += 1) {
    const { selector, title } = targets[index]
    onProgress?.({ index, total, title })
    await yieldForHeavyTask()

    if (!isChartTargetReady(tabRoot, selector)) {
      console.warn('[pdf] chart target not ready:', title, selector)
      continue
    }

    const el = tabRoot.querySelector(selector)
    if (!(el instanceof HTMLElement)) continue

    const chartKey = chartKeyFromSelector(selector)

    try {
      const src = await captureElementToImage(el, chartKey, captureRoot)
      if (src) images.push({ title, src })
    } catch (err) {
      console.warn('[pdf] chart capture failed:', title, err)
      try {
        await yieldToMain(200)
        const src = await captureElementToImage(el, chartKey, captureRoot)
        if (src) images.push({ title, src })
      } catch (retryErr) {
        console.warn('[pdf] chart capture retry failed:', title, retryErr)
      }
    }
    await yieldToMain(YIELD_BETWEEN_CAPTURES_MS)
  }

  return images
}
