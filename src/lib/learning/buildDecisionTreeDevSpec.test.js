import { describe, expect, it } from 'vitest'
import { buildDecisionTreeDevSpec } from './buildDecisionTreeDevSpec.js'

describe('buildDecisionTreeDevSpec', () => {
  it('includes from→to, target files and calibration cases', () => {
    const md = buildDecisionTreeDevSpec({
      id: 'r',
      dimension: 'requestScene',
      fromLabel: '资源操作申请',
      toLabel: '产品信息咨询',
      keywords: ['提升配额'],
      evidenceCount: 5,
      distinctMonths: 2,
      samples: [{ recordId: 't1', taggingText: '如何提升配额' }],
      status: 'needs_tree_patch',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(md).toContain('[打标决策树] 请求场景：资源操作申请 → 产品信息咨询')
    expect(md).toContain('src/lib/requestSceneClassifier.js')
    expect(md).toContain('src/lib/requestSceneClassifier.test.js')
    expect(md).toContain('期望 **产品信息咨询**，不得为 **资源操作申请**')
    expect(md).toContain('preserveManualTags')
  })
})
