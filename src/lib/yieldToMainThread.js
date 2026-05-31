/**
 * 让出主线程，避免长任务连续阻塞 UI（快照重建等）
 */
export function yieldToMainThread() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}
