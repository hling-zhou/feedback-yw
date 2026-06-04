import { describe, expect, it } from 'vitest'
import { SYSTEM_USAGE_WORKFLOW } from './systemWorkflow.js'

describe('systemWorkflow', () => {
  it('defines five ordered steps with automatic step 2', () => {
    expect(SYSTEM_USAGE_WORKFLOW).toHaveLength(5)
    expect(SYSTEM_USAGE_WORKFLOW.map((s) => s.step)).toEqual([1, 2, 3, 4, 5])
    expect(SYSTEM_USAGE_WORKFLOW[1].automatic).toBe(true)
    expect(SYSTEM_USAGE_WORKFLOW[1].modules).toEqual([])
    expect(SYSTEM_USAGE_WORKFLOW[3].modules.map((m) => m.label)).toEqual([
      '洞察工作台',
      '洞察分析',
    ])
  })
})
