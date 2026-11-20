import { describe, expect, it } from 'vitest'
import {
  META_KEY_POST_USE_HTML_REPORTS_V2,
  META_KEY_POST_USE_HTML_REPORT_V2_PREFIX,
  loadHtmlReportOverlay,
  saveHtmlReportOverlay,
} from './htmlReportOverlay.js'

describe('html report overlay store', () => {
  it('saves narratives per month without table numbers', async () => {
    const meta = new Map()
    const adapter = {
      getMeta: async (key) => meta.get(key),
      putMeta: async (key, value) => { meta.set(key, value) },
    }
    await saveHtmlReportOverlay(adapter, {
      month: '2026-06',
      updatedBy: 'alice',
      dataFingerprint: 'fp-1',
      hiddenSectionIds: ['appendix'],
      printAppendix: false,
      narratives: {
        judgment: '本月先看弹性公网IP',
        issues: { 'product:弹性公网IP': { conclusion: '要管', action: '回访' } },
        todoNote: '先办 3 件事',
        visitSupplements: {
          v1: { visitResult: '已回访', internalConclusion: '需求接纳', remark: '下月再看' },
        },
      },
    })
    const loaded = await loadHtmlReportOverlay(adapter, '2026-06')
    expect(loaded.month).toBe('2026-06')
    expect(loaded.narratives.judgment).toBe('本月先看弹性公网IP')
    expect(loaded.narratives.issues['product:弹性公网IP']).toEqual({
      conclusion: '要管',
      action: '回访',
    })
    expect(loaded.narratives.todoNote).toBe('先办 3 件事')
    expect(loaded.narratives.visitSupplements.v1).toEqual({
      visitResult: '已回访',
      internalConclusion: '需求接纳',
      remark: '下月再看',
    })
    // 11-20 V1 下线：save 只写 V2 直键。防污染检查口径：实际写入键无表号数据（avgScore 等）
    const v2Direct = meta.get(`${META_KEY_POST_USE_HTML_REPORT_V2_PREFIX}2026-06`)
    expect(v2Direct).toBeTruthy()
    expect(JSON.stringify(v2Direct)).not.toContain('avgScore')
    // v1/v2 聚合 store 均不被写路径触达（唯一写路径 = V2 直键）
    expect(meta.has(META_KEY_POST_USE_HTML_REPORTS_V2)).toBe(false)
    expect(await loadHtmlReportOverlay(adapter, '2026-07')).toBeNull()
  })

  it('keeps V2 edits isolated and preserves untouched action text', async () => {
    const meta = new Map()
    const adapter = {
      getMeta: async (key) => meta.get(key),
      putMeta: async (key, value) => { meta.set(key, value) },
    }
    await saveHtmlReportOverlay(adapter, {
      month: '2026-10', narratives: {
        judgment: '', issues: {}, todoNote: '',
        actionOverrides: { 'action-1': { owner: '张三' } },
      },
    })
    expect(meta.has(`${META_KEY_POST_USE_HTML_REPORT_V2_PREFIX}2026-10`)).toBe(true)
    expect(meta.has(META_KEY_POST_USE_HTML_REPORTS_V2)).toBe(false)
    expect((await loadHtmlReportOverlay(adapter, '2026-10')).narratives.actionOverrides['action-1']).toEqual({ owner: '张三' })
  })

  it('returns the same saved report snapshot for a later reader', async () => {
    const meta = new Map()
    const adapter = { getMeta: async (key) => meta.get(key), putMeta: async (key, value) => { meta.set(key, value) } }
    const snapshot = { version: 'v2', reportKey: '2026-Q3', kpis: { avg: 9.87 }, products: [{ name: '弹性公网IP' }] }
    await saveHtmlReportOverlay(adapter, {
      month: '2026-Q3', snapshot, hiddenSectionIds: ['appendix'],
      narratives: { judgment: '', issues: {}, todoNote: '', actionOverrides: { focus: { owner: 'liuhao', title: '已核查', detail: '已定位' } }, todoItems: [] },
    })
    snapshot.kpis.avg = 1
    const loaded = await loadHtmlReportOverlay(adapter, '2026-Q3')
    expect(/** @type {any} */ (loaded.snapshot).kpis.avg).toBe(9.87)
    expect(loaded.hiddenSectionIds).toEqual(['appendix'])
    expect(loaded.narratives.actionOverrides.focus).toEqual({ owner: 'liuhao', title: '已核查', detail: '已定位' })
  })

  it('loads previously saved V2 owner edits before a per-period snapshot exists', async () => {
    const meta = new Map([[META_KEY_POST_USE_HTML_REPORTS_V2, {
      version: 1, reports: { '2026-10': { month: '2026-10', narratives: { actionOverrides: { focus: { owner: 'wanjiaan' } } } } },
    }]])
    const adapter = { getMeta: async (key) => meta.get(key), putMeta: async (key, value) => { meta.set(key, value) } }
    const loaded = await loadHtmlReportOverlay(adapter, '2026-10')
    expect(loaded.narratives.actionOverrides.focus.owner).toBe('wanjiaan')
    await saveHtmlReportOverlay(adapter, { ...loaded, snapshot: { version: 'v2', reportKey: '2026-10' } })
    expect((await loadHtmlReportOverlay(adapter, '2026-10')).narratives.actionOverrides.focus.owner).toBe('wanjiaan')
  })
})
