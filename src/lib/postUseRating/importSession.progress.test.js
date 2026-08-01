import { describe, expect, it } from 'vitest'
import { formatPostUseChannelImportProgress } from './importSession.js'

describe('formatPostUseChannelImportProgress', () => {
  it('maps known phases to Chinese progress text', () => {
    expect(formatPostUseChannelImportProgress({ phase: 'parse' })).toBe('正在解析双文件…')
    expect(formatPostUseChannelImportProgress({ phase: 'put_records', detail: '100' })).toBe(
      '正在写入明细 (100)…',
    )
    expect(formatPostUseChannelImportProgress({ phase: 'follow_up_enrich', detail: '12' })).toBe(
      '正在补全投诉回访 (12)…',
    )
    expect(formatPostUseChannelImportProgress({ phase: 'sync' })).toBe('正在同步数据…')
    expect(formatPostUseChannelImportProgress({ phase: 'snapshot' })).toBe(
      '正在生成该数据月份的洞察快照…',
    )
  })
})
