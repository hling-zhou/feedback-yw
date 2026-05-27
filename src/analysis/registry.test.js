import { describe, it, expect } from 'vitest'
import {
  listPipelineDescriptors,
  createPipeline,
  getPipelineDescriptor,
  isRegisteredSource,
  isStubPipeline,
  listStubDataSourceTypes,
} from './registry.js'
import { TicketAnalysisPipeline } from './pipelines/TicketAnalysisPipeline.js'
import { StubAnalysisPipeline } from './pipelines/StubAnalysisPipeline.js'

describe('analysis registry', () => {
  it('registers five data sources', () => {
    expect(listPipelineDescriptors()).toHaveLength(5)
  })

  it('creates ticket pipeline for complaint', () => {
    const p = createPipeline('complaint_ticket')
    expect(p).toBeInstanceOf(TicketAnalysisPipeline)
    expect(getPipelineDescriptor('complaint_ticket')?.importPresetIds).toContain(
      'mobile-cloud-ticket',
    )
  })

  it('creates stub pipeline for post_use_rating', () => {
    const p = createPipeline('post_use_rating')
    expect(p).toBeInstanceOf(StubAnalysisPipeline)
  })

  it('isRegisteredSource', () => {
    expect(isRegisteredSource('user_survey')).toBe(true)
    expect(isRegisteredSource('invalid')).toBe(false)
  })

  it('marks stub vs production pipelines', () => {
    expect(isStubPipeline('complaint_ticket')).toBe(false)
    expect(isStubPipeline('post_use_rating')).toBe(true)
    expect(listStubDataSourceTypes()).toEqual(['post_use_rating', 'user_survey', 'other'])
  })
})
