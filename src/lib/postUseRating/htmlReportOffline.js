/**
 * 报告离线 HTML 下载工具（11-20 V1 下线收敛）：
 * 原 1000+ 行 buildOfflineMonthlyReportHtml（V1 文档组装）随旧版下线删除；
 * V2 导出在页面 buildOfflineHtml 内联组装（renderToStaticMarkup + 样式外壳），
 * 此处只保留文件名与浏览器下载两个纯工具函数。
 */

/** @param {string} reportMonth @param {string} prefix */
export function offlineMonthlyReportFilename(reportMonth, prefix = '用后即评月报') {
  return `${prefix}-${reportMonth || 'unknown'}.html`
}

/**
 * @param {string} html
 * @param {string} filename
 */
export function downloadOfflineMonthlyReportHtml(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
