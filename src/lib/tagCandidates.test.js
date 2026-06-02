import { describe, it, expect } from 'vitest'
import { randomId } from './randomId.js'
import {
  buildTagCandidateMeaning,
  captureJourneyCandidateIfNeeded,
  captureProblemTypeCandidateIfNeeded,
  getTagCandidateTarget,
  isKnownProblemType,
  isValidJourneyPair,
  mergeTagCandidate,
  countPendingDuplicateCandidates,
} from './tagCandidates.js'
import { candidateDedupeKey, createTagCandidate } from '../domain/tagCandidate.js'

const journeys = [
  {
    id: 'buy',
    label: '购买',
    children: [{ id: 'order', label: '下单', keywords: ['下单'] }],
  },
]

describe('tagCandidates', () => {
  it('detects invalid journey pair', () => {
    expect(
      isValidJourneyPair({ journeyL1: '购买', journeyL2: '下单' }, journeys),
    ).toBe(true)
    expect(
      isValidJourneyPair({ journeyL1: '新环节', journeyL2: '子环节' }, journeys),
    ).toBe(false)
  })

  it('capture returns candidate for out-of-catalog llm labels', () => {
    const c = captureJourneyCandidateIfNeeded({
      llm: { journeyL1: '新环节', journeyL2: '子环节' },
      journeys,
      taxonomyKey: 'generic',
    })
    expect(c?.proposedLabel).toContain('新环节')
    expect(c?.status).toBe('pending')
    expect(c?.tagMeaning).toMatch(/用户旅程|一级/)
    expect(getTagCandidateTarget(c).groupKey).toMatch(/^journey:/)
  })

  it('detects unknown problem type from import column', () => {
    const types = [{ label: '计费与账单', keywords: ['账单'] }]
    expect(isKnownProblemType('计费与账单', types)).toBe(true)
    expect(isKnownProblemType('全新问题类型', types)).toBe(false)
    expect(isKnownProblemType('未分类', types)).toBe(true)

    const c = captureProblemTypeCandidateIfNeeded({
      problemType: '全新问题类型',
      problemTypes: types,
      problemTypeCol: '全新问题类型',
      taxonomyKey: 'generic',
    })
    expect(c?.tagType).toBe('problem_type')
    expect(c?.proposedLabel).toBe('全新问题类型')
    expect(c?.tagMeaning).toMatch(/问题类型|共用/)
    expect(getTagCandidateTarget(c).groupKey).toBe('problem_type')
  })

  it('capture problem type with llm origin', () => {
    const types = [{ label: '计费与账单', keywords: ['账单'] }]
    const c = captureProblemTypeCandidateIfNeeded({
      problemType: 'LLM 新类型',
      problemTypes: types,
      origin: 'llm',
    })
    expect(c?.origin).toBe('llm')
    expect(c?.proposedLabel).toBe('LLM 新类型')
  })

  it('tag meaning describes label semantics not occurrence', () => {
    const text = buildTagCandidateMeaning({
      tagType: 'problem_type',
      proposedLabel: '新类型',
      taxonomyKey: 'generic',
      origin: 'local_overflow',
      occurrenceCount: 3,
      status: 'pending',
      id: '1',
      tenantId: 'local',
      createdAt: new Date().toISOString(),
    })
    expect(text).toMatch(/问题类型/)
    expect(text).not.toContain('3 次')
  })

  it('problem_type dedupe ignores per-record productKey', () => {
    const a = createTagCandidate({
      tagType: 'problem_type',
      proposedLabel: '全新问题类型',
      taxonomyKey: 'ecs',
      status: 'pending',
    })
    const b = createTagCandidate({
      tagType: 'problem_type',
      proposedLabel: '全新问题类型',
      taxonomyKey: 'eip',
      status: 'pending',
    })
    expect(candidateDedupeKey(a)).toBe(candidateDedupeKey(b))
    expect(countPendingDuplicateCandidates([a, b])).toBe(1)
  })

  it('countPendingDuplicateCandidates counts extra pending rows', () => {
    const a = createTagCandidate({ tagType: 'problem_type', proposedLabel: 'X', status: 'pending' })
    const b = createTagCandidate({ tagType: 'problem_type', proposedLabel: 'X', status: 'pending' })
    const c = createTagCandidate({ tagType: 'problem_type', proposedLabel: 'Y', status: 'pending' })
    expect(countPendingDuplicateCandidates([a, b, c])).toBe(1)
    expect(countPendingDuplicateCandidates([a])).toBe(0)
  })

  it('mergeTagCandidate increments count', () => {
    const list = []
    const a = createTagCandidate({ tagType: 'journey_l2', proposedLabel: 'A > B' })
    mergeTagCandidate(list, a)
    mergeTagCandidate(list, { ...a, id: randomId() })
    expect(list).toHaveLength(1)
    expect(list[0].occurrenceCount).toBe(2)
  })
})
