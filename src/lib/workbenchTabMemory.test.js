/**
 * 洞察工作台 Tab 记忆单测（2026-11-09）。
 * 红绿锚点：resolveInitialWorkbenchTab 三级优先链 + 白名单防脏值。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isValidWorkbenchTab,
  readWorkbenchLastActiveTab,
  rememberWorkbenchActiveTab,
  resolveInitialWorkbenchTab,
  WORKBENCH_TAB_WHITELIST,
} from './workbenchTabMemory.js'

/** node 环境无 localStorage：最小内存 stub */
function installMemoryStorage() {
  const store = new Map()
  const stub = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(String(key), String(value)),
    removeItem: (key) => void store.delete(String(key)),
    clear: () => store.clear(),
  }
  vi.stubGlobal('localStorage', stub)
  return store
}

describe('workbenchTabMemory', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('白名单 = overview + 可导入数据源类型', () => {
    expect(WORKBENCH_TAB_WHITELIST[0]).toBe('overview')
    expect(WORKBENCH_TAB_WHITELIST).toContain('post_use_rating')
    expect(WORKBENCH_TAB_WHITELIST).toContain('complaint_ticket')
    expect(WORKBENCH_TAB_WHITELIST).not.toContain('reminder')
  })

  describe('resolveInitialWorkbenchTab 优先级链', () => {
    it('URL 显式参数 > 上次 Tab', () => {
      expect(resolveInitialWorkbenchTab('complaint_ticket', 'post_use_rating')).toBe(
        'complaint_ticket',
      )
    })

    it('无参数时回退到上次 Tab', () => {
      expect(resolveInitialWorkbenchTab(null, 'post_use_rating')).toBe('post_use_rating')
      expect(resolveInitialWorkbenchTab('', 'post_use_rating')).toBe('post_use_rating')
    })

    it('两者都无 → 第一个 Tab（overview）', () => {
      expect(resolveInitialWorkbenchTab(null, '')).toBe('overview')
      expect(resolveInitialWorkbenchTab(undefined, undefined)).toBe('overview')
    })

    it('非法参数不拦截合法记忆（脏参数按无参数处理）', () => {
      expect(resolveInitialWorkbenchTab('evil_tab', 'post_use_rating')).toBe('post_use_rating')
    })

    it('非法记忆不生效（数据源类型增删后的残留脏值）', () => {
      expect(resolveInitialWorkbenchTab(null, 'removed_source_type')).toBe('overview')
    })

    it('参数与记忆都非法 → overview', () => {
      expect(resolveInitialWorkbenchTab('x', 'y')).toBe('overview')
    })

    it('参数带空白容忍 trim', () => {
      expect(resolveInitialWorkbenchTab('  post_use_rating  ', '')).toBe('post_use_rating')
    })
  })

  describe('localStorage 读写', () => {
    it('remember 后 read 取回同值', () => {
      rememberWorkbenchActiveTab('consultation_ticket')
      expect(readWorkbenchLastActiveTab()).toBe('consultation_ticket')
    })

    it('非法 Tab 不写入', () => {
      rememberWorkbenchActiveTab('not_a_tab')
      expect(readWorkbenchLastActiveTab()).toBe('')
    })

    it('localStorage 抛异常时静默降级（读返回空、写不抛）', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('quota')
        },
        setItem: () => {
          throw new Error('quota')
        },
      })
      expect(readWorkbenchLastActiveTab()).toBe('')
      expect(() => rememberWorkbenchActiveTab('overview')).not.toThrow()
    })
  })

  it('isValidWorkbenchTab 对空值返回 false', () => {
    expect(isValidWorkbenchTab('')).toBe(false)
    expect(isValidWorkbenchTab(null)).toBe(false)
    expect(isValidWorkbenchTab('overview')).toBe(true)
  })
})
