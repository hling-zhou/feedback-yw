import { describe, expect, it } from 'vitest'
import { isImportTaggingPhase } from './taggingTaskUI.js'

describe('taggingTaskUI', () => {
  it('isImportTaggingPhase detects tagging progress text', () => {
    expect(isImportTaggingPhase('正在增强打标 (3/10)…')).toBe(true)
    expect(isImportTaggingPhase('正在规则初标 (0/5)…')).toBe(true)
    expect(isImportTaggingPhase('正在请求场景与问题类型 (1/10)…')).toBe(false)
    expect(isImportTaggingPhase('正在准备分析…')).toBe(false)
  })
})
