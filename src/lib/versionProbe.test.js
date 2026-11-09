import { describe, expect, it } from 'vitest'
import {
  buildCacheBustingUrl,
  extractAssetFingerprint,
  getCurrentAssetFingerprint,
  isVersionOutdated,
} from './versionProbe.js'

/**
 * 版本探针纯逻辑测试（2026-11-09）。
 *
 * 真实输入样本锚定：指纹格式 = Vite 构建产物的实际形态
 * （dist/index.html 里 src/href 引 /assets/index-<hash>.js|css），
 * 防止测试与实现共享"随手编"的错误心智模型。
 */

const PROD_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%3E" />
    <link rel="stylesheet" crossorigin href="/assets/index-QN62NotS.css">
    <script type="module" crossorigin src="/assets/index-DNr4N5jY.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`

const PROD_HTML_V2 = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="stylesheet" crossorigin href="/assets/index-Ab12Cd34.css">
    <script type="module" crossorigin src="/assets/index-Ef56Gh78.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`

const DEV_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <script type="module" src="/src/main.jsx"></script>
  </head>
</html>`

describe('extractAssetFingerprint', () => {
  it('生产 HTML：提取全部 /assets/ 引用并排序拼接为指纹', () => {
    const fp = extractAssetFingerprint(PROD_HTML)
    expect(fp).toBe('/assets/index-DNr4N5jY.js|/assets/index-QN62NotS.css')
  })

  it('不同版本的 HTML 指纹必然不同（核心判据）', () => {
    expect(extractAssetFingerprint(PROD_HTML)).not.toBe(extractAssetFingerprint(PROD_HTML_V2))
  })

  it('dev HTML（无 /assets/ 引用）返回 null —— 探针 no-op 边界', () => {
    expect(extractAssetFingerprint(DEV_HTML)).toBeNull()
  })

  it('空串 / 非字符串返回 null，不抛异常', () => {
    expect(extractAssetFingerprint('')).toBeNull()
    expect(/** @type {any} */ (extractAssetFingerprint)(null)).toBeNull()
    expect(/** @type {any} */ (extractAssetFingerprint)(undefined)).toBeNull()
  })

  it('忽略非 /assets/ 的引用（外链 CDN、data: 图标等）', () => {
    const html = `<html><head>
      <link rel="icon" href="data:image/svg+xml,%3Csvg%3E">
      <link rel="stylesheet" href="https://cdn.example.com/x.css">
      <script src="/assets/index-AAA11111.js"></script>
    </head></html>`
    expect(extractAssetFingerprint(html)).toBe('/assets/index-AAA11111.js')
  })
})

describe('isVersionOutdated', () => {
  it('两侧指纹齐全且不同 → 过期', () => {
    expect(isVersionOutdated('/assets/a.js', '/assets/b.js')).toBe(true)
  })

  it('指纹相同 → 不过期', () => {
    expect(isVersionOutdated('/assets/a.js', '/assets/a.js')).toBe(false)
  })

  it('任一侧为 null（dev 形态 / 探针失败）→ 不过期（宁缺勿误报）', () => {
    expect(isVersionOutdated(null, '/assets/b.js')).toBe(false)
    expect(isVersionOutdated('/assets/a.js', null)).toBe(false)
    expect(isVersionOutdated(null, null)).toBe(false)
  })
})

describe('buildCacheBustingUrl', () => {
  it('无查询串的路径追加 ?_v=', () => {
    expect(buildCacheBustingUrl('/feedbacks', '123')).toBe('/feedbacks?_v=123')
  })

  it('已有查询串的路径追加 &_v=（保留既有筛选参数）', () => {
    expect(buildCacheBustingUrl('/feedbacks?source=x&month=2026-07', '123')).toBe(
      '/feedbacks?source=x&month=2026-07&_v=123',
    )
  })

  it('nonce 缺省时自动生成（非空时间戳）', () => {
    expect(buildCacheBustingUrl('/x').startsWith('/x?_v=')).toBe(true)
    expect(buildCacheBustingUrl('/x')).not.toBe('/x?_v=')
  })

  it('nonce 含特殊字符时被 URL 编码', () => {
    expect(buildCacheBustingUrl('/x', 'a b&c')).toBe('/x?_v=a%20b%26c')
  })
})

describe('getCurrentAssetFingerprint（DOM 读取）', () => {
  it('从 DOM 的 script/link 资产引用提取指纹（JSDOM document）', () => {
    const doc = /** @type {unknown} */ ({
      baseURI: 'http://localhost:5175/',
      querySelectorAll: (sel) => {
        // 模拟真实 DOM：script[src] 与 link[rel=stylesheet][href]
        if (sel === 'script[src], link[rel="stylesheet"][href]') {
          return [
            { src: 'http://localhost:5175/assets/index-DNr4N5jY.js', href: '' },
            { href: 'http://localhost:5175/assets/index-QN62NotS.css', src: '' },
          ]
        }
        return []
      },
    })
    // jsdom 环境下 HTMLLinkElement 构造器不可用，这里只验证分支容错：
    // 传一个"鸭子类型" document，靠 instanceof 失败后的 el.src 取值路径
    const fp = getCurrentAssetFingerprint(/** @type {Document} */ (doc))
    expect(fp).toBe('/assets/index-DNr4N5jY.js|/assets/index-QN62NotS.css')
  })

  it('DOM 无 /assets/ 引用（dev 形态）返回 null', () => {
    const doc = /** @type {unknown} */ ({
      baseURI: 'http://localhost:5175/',
      querySelectorAll: () => [{ src: 'http://localhost:5175/src/main.jsx', href: '' }],
    })
    expect(getCurrentAssetFingerprint(/** @type {Document} */ (doc))).toBeNull()
  })

  it('跨源资产不参与指纹', () => {
    const doc = /** @type {unknown} */ ({
      baseURI: 'http://localhost:5175/',
      querySelectorAll: () => [
        { src: 'https://cdn.example.com/assets/index-x.js', href: '' },
      ],
    })
    expect(getCurrentAssetFingerprint(/** @type {Document} */ (doc))).toBeNull()
  })
})
