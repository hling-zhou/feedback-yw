import { describe, expect, it } from 'vitest'
import {
  mergeTeamAndLocalSettings,
  pickPersonalLlmSettings,
  pickTeamAppSettings,
} from './appSettingsPersist.js'

describe('pickTeamAppSettings', () => {
  it('excludes LLM and secrets from team shared payload', () => {
    const picked = pickTeamAppSettings({
      useRegex: true,
      themeMatchMode: 'hybrid',
      quoteExtraction: { complaint_ticket: 'plain' },
      llmBaseUrl: 'https://api.example.com/v1',
      llmModel: 'gpt-4',
      llmApiKey: 'secret',
    })
    expect(picked).toMatchObject({
      useRegex: true,
      themeMatchMode: 'hybrid',
      quoteExtraction: { complaint_ticket: 'plain' },
    })
    expect(picked).not.toHaveProperty('llmBaseUrl')
    expect(picked).not.toHaveProperty('llmModel')
    expect(picked).not.toHaveProperty('llmApiKey')
  })
})

describe('pickPersonalLlmSettings', () => {
  it('includes only LLM connection fields', () => {
    const picked = pickPersonalLlmSettings({
      llmBaseUrl: 'https://api.example.com/v1',
      llmModel: 'gpt-4',
      llmApiKey: 'sk-x',
      themeMatchMode: 'keyword',
    })
    expect(picked).toEqual({
      llmBaseUrl: 'https://api.example.com/v1',
      llmModel: 'gpt-4',
      llmApiKey: 'sk-x',
    })
  })
})

describe('mergeTeamAndLocalSettings', () => {
  it('applies team rules and keeps local api key', () => {
    const merged = mergeTeamAndLocalSettings(
      { themeMatchMode: 'semantic', useRegex: false },
      {
        themeMatchMode: 'keyword',
        useRegex: true,
        llmApiKey: 'local-key',
        llmBaseUrl: 'https://local/v1',
        llmModel: 'local-model',
      },
    )
    expect(merged.themeMatchMode).toBe('semantic')
    expect(merged.useRegex).toBe(false)
    expect(merged.llmApiKey).toBe('local-key')
    expect(merged.llmBaseUrl).toBe('https://local/v1')
  })

  it('falls back to legacy team llm url when local empty', () => {
    const merged = mergeTeamAndLocalSettings(
      { llmBaseUrl: 'https://legacy/v1', llmModel: 'legacy-m' },
      { llmApiKey: '', llmBaseUrl: '', llmModel: '' },
    )
    expect(merged.llmBaseUrl).toBe('https://legacy/v1')
    expect(merged.llmModel).toBe('legacy-m')
  })
})
