import { useEffect, useRef, useState } from 'react'
import { Alert, Button } from 'antd'
import {
  buildCacheBustingUrl,
  extractAssetFingerprint,
  getCurrentAssetFingerprint,
  isVersionOutdated,
} from '../lib/versionProbe.js'

/**
 * 长开标签页的「新版本可用」横幅（2026-11-09 缓存陈旧问题修复）。
 *
 * 机制：进入页面时记录当前 DOM 的资产指纹；每 PROBE_INTERVAL_MS 用
 * no-store 拉一次入口 HTML 提取最新指纹，指纹变化 → 横幅提示刷新。
 * 刷新动作带缓存穿透参数（见 buildCacheBustingUrl），确保拿到的
 * 一定是最新的 index.html，而不是 HTTP 缓存里的旧版。
 *
 * no-op 边界（宁缺勿误报）：
 * - dev 形态（DOM 无 /assets/index-*.js 引用）不轮询不渲染；
 * - 探针 fetch 失败 / 非 200 / 指纹提取失败 → 本轮静默跳过；
 * - 用户点「稍后」关闭横幅后本轮会话不再打扰（刷新页面后重置）。
 *
 * 不做自动强刷：保留用户正在编辑的表单状态由用户自己决定时机。
 */
const PROBE_INTERVAL_MS = 5 * 60 * 1000 // 5 分钟：与 dataRevision 轮询节奏同量级，够新且不吵
const PROBE_TIMEOUT_MS = 8000

export default function VersionRefreshBanner() {
  const [outdated, setOutdated] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  /** @type {import('react').MutableRefObject<string | null>} */
  const currentFingerprintRef = useRef(null)

  useEffect(() => {
    // dev 形态（无指纹资产）整个探针 no-op；StrictMode 双执行也安全（同指纹幂等）。
    const current = getCurrentAssetFingerprint()
    if (!current) return undefined
    currentFingerprintRef.current = current

    let cancelled = false
    const probe = async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
      try {
        const res = await fetch('/index.html', { cache: 'no-store', signal: controller.signal })
        if (!res.ok) return
        const html = await res.text()
        const latest = extractAssetFingerprint(html)
        if (cancelled || !latest) return
        if (isVersionOutdated(currentFingerprintRef.current, latest)) {
          setOutdated(true)
        }
      } catch {
        // 网络/超时/中断：静默跳过本轮，下一轮再试
      } finally {
        clearTimeout(timer)
      }
    }

    // 挂载即探测一轮（覆盖「打开系统看到的 index.html 已是缓存旧版」的主场景），
    // 再按间隔轮询覆盖「一直开着的旧标签页」。
    void probe()
    const interval = setInterval(() => void probe(), PROBE_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (!outdated || dismissed) return null

  const handleRefresh = () => {
    const { pathname, search } = globalThis.location
    globalThis.location.replace(buildCacheBustingUrl(pathname + search))
  }

  return (
    <Alert
      className="page-section-sm"
      type="info"
      showIcon
      title="新版本已发布"
      description={
        <span className="text-ink-600">
          系统有新版本，当前页面仍在运行旧版。建议刷新以启用最新功能。
          <Button type="link" size="small" className="!px-1" onClick={handleRefresh}>
            立即刷新
          </Button>
          <Button type="text" size="small" className="!px-1" onClick={() => setDismissed(true)}>
            稍后
          </Button>
        </span>
      }
    />
  )
}
