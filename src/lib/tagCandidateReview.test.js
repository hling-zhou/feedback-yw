import { describe, it, expect } from 'vitest'
import {
  buildTagCandidateMeaning,
  getTagCandidateTarget,
  groupTagCandidates,
} from './tagCandidateReview.js'

describe('tagCandidateReview', () => {
  it('maps problem type to shared config', () => {
    const target = getTagCandidateTarget({
      tagType: 'problem_type',
      proposedLabel: '新类型',
      status: 'pending',
      id: '1',
      tenantId: 'local',
      createdAt: '',
      origin: 'local_overflow',
    })
    expect(target.groupKey).toBe('problem_type')
    expect(target.jsonPath).toContain('index.json')
    expect(target.adoptTarget).toContain('sharedProblemTypes')
  })

  it('maps journey to product json', () => {
    const target = getTagCandidateTarget({
      tagType: 'journey_l2',
      proposedLabel: '购买 > 下单',
      taxonomyKey: 'eip',
      journeyL1: '购买',
      journeyL2: '下单',
      status: 'pending',
      id: '1',
      tenantId: 'local',
      createdAt: '',
      origin: 'llm',
    })
    expect(target.groupKey).toBe('journey:eip')
    expect(target.jsonPath).toContain('eip.json')
  })

  it('meaning does not include ticket excerpt', () => {
    const text = buildTagCandidateMeaning({
      tagType: 'problem_type',
      proposedLabel: '计费争议',
      evidenceExcerpt: '客户投诉账单不对',
      status: 'pending',
      id: '1',
      tenantId: 'local',
      createdAt: '',
      origin: 'local_overflow',
    })
    expect(text).toContain('问题类型')
    expect(text).not.toContain('客户投诉')
    expect(text).not.toContain('摘录')
  })

  it('groups problem types before journeys', () => {
    const groups = groupTagCandidates([
      {
        tagType: 'journey_l2',
        proposedLabel: 'A > B',
        taxonomyKey: 'generic',
        status: 'pending',
        id: '1',
        tenantId: 'local',
        createdAt: '',
        origin: 'llm',
      },
      {
        tagType: 'problem_type',
        proposedLabel: '新',
        status: 'pending',
        id: '2',
        tenantId: 'local',
        createdAt: '',
        origin: 'local_overflow',
      },
    ])
    expect(groups[0].target.groupKey).toBe('problem_type')
  })
})
