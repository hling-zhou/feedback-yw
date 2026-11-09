/**
 * 前端版本探针（2026-11-09 缓存陈旧问题修复）。
 *
 * 背景：Nginx 托管 dist/，index.html 无缓存策略时浏览器可将其缓存数日，
 * 长开的旧标签页永远停在旧 bundle 上（新功能不可见）。本模块从「页面自身
 * 引用的资产指纹」推导当前版本，供 UI 层轮询比对入口 HTML 的最新指纹。
 *
 * 设计约束：
 * - 不依赖构建期注入（如 __APP_VERSION__）——指纹直接取自 DOM 实况，
 *   dev / preview / 生产构建三种形态同一套逻辑；
 * - dev 形态（无 /assets/index-*.js 引用）一律 no-op，避免开发时的假阳性；
 * - 纯函数无副作用，fetch 拆到组件层（便于单测与超时控制）。
 */

/** 入口 HTML 中 Vite 指纹资产的 script/link 引用模式（assets/index-<hash>.js 等）。 */
const ASSET_FINGERPRINT_RE = /(?:src|href)="(\/assets\/[^"]+?)"/g

/**
 * 从 HTML 文本提取资产指纹（排序去重后的资产路径集合，作为该 HTML 的版本标识）。
 * 提取不到任何 /assets/ 引用时返回 null（dev 形态或非本项目 HTML）。
 * @param {string} htmlText
 * @returns {string | null}
 */
export function extractAssetFingerprint(htmlText) {
  if (typeof htmlText !== 'string' || htmlText.length === 0) return null
  /** @type {string[]} */
  const assets = []
  let m
  ASSET_FINGERPRINT_RE.lastIndex = 0
  while ((m = ASSET_FINGERPRINT_RE.exec(htmlText)) !== null) {
    assets.push(m[1])
  }
  if (assets.length === 0) return null
  return assets.slice().sort().join('|')
}

/**
 * 读取当前页面 DOM 实际引用的资产指纹（本轮 bundle 的"当前版本"）。
 * 取 document.querySelectorAll('script[src], link[href]') 中 /assets/ 路径。
 * @param {Document} [doc]
 * @returns {string | null} dev 形态（无指纹资产引用）返回 null
 */
export function getCurrentAssetFingerprint(doc = document) {
  /** @type {string[]} */
  const assets = []
  // 同源基准：文档自身 baseURI（node 测试环境无 globalThis.location，
  // 以 doc.baseURI 为准；两者都无则跳过同源过滤，只按路径判定）。
  const baseHref = doc.baseURI || (globalThis.location && globalThis.location.href) || ''
  let baseOrigin = null
  try {
    if (baseHref) baseOrigin = new URL(baseHref).origin
  } catch {
    baseOrigin = null
  }
  doc
    .querySelectorAll('script[src], link[rel="stylesheet"][href]')
    .forEach((el) => {
      // script 元素只有 .src，link 元素只有 .href（另一侧 undefined）；
      // 防御性取值兼容 node 测试环境的鸭子类型 document（无 HTMLLinkElement 构造器）。
      const url = el.href || el.src
      if (!url) return
      // 仅统计本项目指纹资产（同源 /assets/ 路径）；外链（CDN 等）不参与版本判定。
      let path = ''
      try {
        const u = new URL(url, baseHref || undefined)
        if (baseOrigin && u.origin !== baseOrigin) return
        path = u.pathname
      } catch {
        return
      }
      if (path.startsWith('/assets/')) assets.push(path)
    })
  if (assets.length === 0) return null
  return assets.slice().sort().join('|')
}

/**
 * 版本是否过期：当前指纹与最新指纹都存在且不相等 → 过期。
 * 任一侧缺失（dev 形态 / 探针失败）一律「不过期」，宁缺勿误报。
 * @param {string | null} current
 * @param {string | null} latest
 * @returns {boolean}
 */
export function isVersionOutdated(current, latest) {
  if (!current || !latest) return false
  return current !== latest
}

/**
 * 构造缓存穿透刷新 URL：在当前地址追加一次性查询参数。
 * 服务端/Nginx 对带参 URL 默认不命中静态缓存（不同 cache key），
 * 即使 index.html 仍被浏览器缓存策略误缓存，穿透参数也强制重新拉取。
 * 纯字符串操作，不含 window 依赖，便于单测。
 * @param {string} pathnameWithSearch 当前地址（pathname + search，不含 hash）
 * @param {string} [nonce] 一次性参数值（缺省由调用方生成）
 * @returns {string}
 */
export function buildCacheBustingUrl(pathnameWithSearch, nonce = '') {
  const n = nonce || String(Date.now())
  const sep = pathnameWithSearch.includes('?') ? '&' : '?'
  return `${pathnameWithSearch}${sep}_v=${encodeURIComponent(n)}`
}
