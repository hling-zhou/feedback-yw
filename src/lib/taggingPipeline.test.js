import { describe, expect, it } from 'vitest'
import {
  fullTaggingStageOrder,
  llmStageOrderAfterShared,
  resolveTaggingPipelineOrder,
} from './taggingPipeline.js'
import { DEFAULT_TAGGING_PIPELINE_ORDER } from './storage.js'

describe('taggingPipeline', () => {
  it('defaults to ticket_first', () => {
    expect(DEFAULT_TAGGING_PIPELINE_ORDER).toBe('ticket_first')
    expect(resolveTaggingPipelineOrder({})).toBe('ticket_first')
  })

  it('options.pipelineOrder overrides settings', () => {
    expect(
      resolveTaggingPipelineOrder(
        { taggingPipelineOrder: 'ticket_first' },
        { pipelineOrder: 'legacy' },
      ),
    ).toBe('legacy')
  })

  it('O-01: ticket_first runs ticket LLM before journey', () => {
    expect(llmStageOrderAfterShared('ticket_first')).toEqual(['ticketLlm', 'journey'])
    expect(fullTaggingStageOrder('ticket_first')).toEqual([
      'sharedDimensions',
      'ticketLlm',
      'journey',
    ])
  })

  it('O-03: legacy runs journey before ticket LLM', () => {
    expect(llmStageOrderAfterShared('legacy')).toEqual(['journey', 'ticketLlm'])
    expect(fullTaggingStageOrder('legacy')).toEqual([
      'sharedDimensions',
      'journey',
      'ticketLlm',
    ])
  })
})
