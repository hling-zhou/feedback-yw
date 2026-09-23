export const BACKGROUND_TASK_PROGRESS_THROTTLE_MS = 1500

/**
 * 进度文案的阶段指纹：数字变化视为同一阶段，文案结构变化视为新阶段。
 * @param {string | undefined} text
 */
export function backgroundTaskProgressPhaseKey(text) {
  return String(text || '').replace(/\d+/g, '#')
}

/**
 * 是否应立刻把本地进度写到服务端锁（阶段切换立即写，计数变化节流）。
 * @param {{ text?: string; at?: number } | null | undefined} prev
 * @param {string | undefined} nextText
 * @param {number} [now]
 * @param {number} [throttleMs]
 */
export function shouldPublishBackgroundTaskProgress(
  prev,
  nextText,
  now = Date.now(),
  throttleMs = BACKGROUND_TASK_PROGRESS_THROTTLE_MS,
) {
  const text = String(nextText || '').trim()
  if (!text) return false
  if (!prev?.text) return true
  if (backgroundTaskProgressPhaseKey(prev.text) !== backgroundTaskProgressPhaseKey(text)) {
    return true
  }
  return now - (prev.at || 0) >= throttleMs
}
