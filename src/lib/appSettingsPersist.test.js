import { describe, expect, it } from 'vitest'
import { mergeTeamAndLocalSettings, pickTeamAppSettings } from './appSettingsPersist.js'

describe('pickTeamAppSettings', () => {
  it('excludes LLM and secrets from team shared payload', () => {
    const picked = pickTeamAppSettings({
      useRegex: true,
      themeMatchMode: 'hybrid',
      quoteExtraction: { complaint_ticket: 'plain' },
      postUseKeyCustomers: ['中国铁塔'],
      llmBaseUrl: 'https://api.example.com/v1',
      llmModel: 'gpt-4',
      llmApiKey: 'secret',
    })
    expect(picked).toMatchObject({
      useRegex: true,
      themeMatchMode: 'hybrid',
      quoteExtraction: { complaint_ticket: 'plain' },
      postUseKeyCustomers: ['中国铁塔'],
    })
    expect(picked).not.toHaveProperty('llmBaseUrl')
    expect(picked).not.toHaveProperty('llmModel')
    expect(picked).not.toHaveProperty('llmApiKey')
  })
})

describe('mergeTeamAndLocalSettings', () => {
  it('applies team rules and no longer merges LLM fields', () => {
    const merged = mergeTeamAndLocalSettings(
      { themeMatchMode: 'semantic', useRegex: false, postUseKeyCustomers: ['中国铁塔'] },
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
    expect(merged.postUseKeyCustomers).toEqual(['中国铁塔'])
    // LLM 配置已独立存于 llm_config_v1，团队分析设置不再覆盖本机 LLM 字段
    expect(merged.llmApiKey).toBe('local-key')
    expect(merged.llmBaseUrl).toBe('https://local/v1')
  })

  it('ignores legacy team llm fields', () => {
    const merged = mergeTeamAndLocalSettings(
      { llmBaseUrl: 'https://legacy/v1', llmModel: 'legacy-m' },
      { llmApiKey: '', llmBaseUrl: '', llmModel: '' },
    )
    // 旧版残留的 llmBaseUrl/llmModel 不再被合并进来
    expect(merged.llmBaseUrl).toBe('')
    expect(merged.llmModel).toBe('')
  })
})
