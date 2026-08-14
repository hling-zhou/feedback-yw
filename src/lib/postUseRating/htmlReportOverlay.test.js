import { describe, expect, it } from 'vitest'
import {
  META_KEY_POST_USE_HTML_REPORTS,
  loadHtmlReportOverlay,
  saveHtmlReportOverlay,
} from './htmlReportOverlay.js'

describe('html report overlay store', () => {
  it('saves narratives per month without table numbers', async () => {
    const meta = new Map()
    const adapter = {
      getMeta: async (key) => meta.get(key),
      putMeta: async (key, value) => meta.set(key, value),
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
    expect(JSON.stringify(meta.get(META_KEY_POST_USE_HTML_REPORTS))).not.toContain('avgScore')
    expect(await loadHtmlReportOverlay(adapter, '2026-07')).toBeNull()
  })
})
