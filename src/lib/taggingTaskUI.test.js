import { describe, expect, it } from 'vitest'
import { isImportTaggingPhase } from './taggingTaskUI.js'

describe('taggingTaskUI', () => {
  it('isImportTaggingPhase detects tagging progress text', () => {
    expect(isImportTaggingPhase('正在完整打标 (3/10)…')).toBe(true)
    expect(isImportTaggingPhase('正在执行分析流水线 (0/5)…')).toBe(false)
    expect(isImportTaggingPhase('正在准备分析…')).toBe(false)
  })
})
