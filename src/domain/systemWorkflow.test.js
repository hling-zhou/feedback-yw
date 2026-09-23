import { describe, expect, it } from 'vitest'
import { SYSTEM_USAGE_WORKFLOW } from './systemWorkflow.js'

describe('systemWorkflow', () => {
  it('defines six ordered steps with automatic step 2', () => {
    expect(SYSTEM_USAGE_WORKFLOW).toHaveLength(6)
    expect(SYSTEM_USAGE_WORKFLOW.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6])
    expect(SYSTEM_USAGE_WORKFLOW[1].automatic).toBe(true)
    expect(SYSTEM_USAGE_WORKFLOW[1].modules).toEqual([])
    expect(SYSTEM_USAGE_WORKFLOW[3].modules).toEqual([
      { label: '洞察工作台', route: '/workbench' },
      { label: '洞察分析', route: '/workbench/analysis' },
    ])
    expect(SYSTEM_USAGE_WORKFLOW[4].modules).toEqual([
      { label: '专题分析', route: '/topics', badge: 'Beta' },
    ])
  })
})
