/**
 * 让出主线程，避免长时间同步任务触发浏览器「页面无响应」。
 * @param {number} [delayMs]
 */
export function yieldToMain(delayMs = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

/** 等待下一帧后再让出，便于图表完成布局/绘制 */
export function yieldToNextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0)
    })
  })
}

/** 连续让出数帧，供重任务前刷新 loading 态 */
export async function yieldForHeavyTask() {
  await yieldToNextFrame()
  await yieldToNextFrame()
  await yieldToMain(32)
  const sched = globalThis.scheduler
  if (sched && typeof sched.yield === 'function') {
    await sched.yield()
  }
}

/**
 * 在浏览器空闲时再执行下一步重任务
 * @param {number} [timeoutMs]
 */
export function yieldUntilIdle(timeoutMs = 120) {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: timeoutMs })
      return
    }
    setTimeout(resolve, Math.min(timeoutMs, 48))
  })
}
