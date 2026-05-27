import { describe, it, expect } from 'vitest'
import { pickImportRowMeta } from './importUtils.js'

describe('pipeline import month metadata', () => {
  it('import row meta is preserved for ticket pipeline merge', () => {
    const row = {
      importMonth: '2025-04',
      importBatchId: '2025-04-123',
      importBatchName: '2025-04 投诉工单导入',
      importFileName: 'tickets.xlsx',
      importedAt: '2025-04-01T08:00:00.000Z',
      handlingText: '测试',
      rawText: '测试',
      productSpec: '弹性云服务器',
    }
    const meta = pickImportRowMeta(row)
    const merged = {
      id: 'x',
      problemType: '未分类',
      journeyL1: '未识别环节',
      journeyL2: '未识别子环节',
      ...meta,
    }
    expect(merged.importMonth).toBe('2025-04')
    expect(merged.importBatchId).toBe('2025-04-123')
    expect(merged.importedAt).toBe('2025-04-01T08:00:00.000Z')
  })
})
