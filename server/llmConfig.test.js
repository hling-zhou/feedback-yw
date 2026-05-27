import { afterEach, describe, expect, it } from 'vitest'
import {
  isLlmConfigured,
  normalizeLlmBaseUrl,
  resolveLlmApiKeyForRequest,
  resolveLlmBaseUrl,
  resolveLlmModel,
} from './llmConfig.js'

const envBackup = { ...process.env }

afterEach(() => {
  process.env = { ...envBackup }
})

describe('normalizeLlmBaseUrl', () => {
  it('strips trailing slash and chat path', () => {
    expect(normalizeLlmBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
    expect(normalizeLlmBaseUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1',
    )
  })
})

describe('isLlmConfigured', () => {
  it('is false without LLM_API_KEY', () => {
    delete process.env.LLM_API_KEY
    expect(isLlmConfigured()).toBe(false)
  })

  it('is true when LLM_API_KEY is set', () => {
    process.env.LLM_API_KEY = 'sk-test'
    expect(isLlmConfigured()).toBe(true)
  })
})

describe('resolveLlmApiKeyForRequest', () => {
  it('prefers server env key', () => {
    process.env.LLM_API_KEY = 'sk-server'
    expect(resolveLlmApiKeyForRequest({ apiKey: 'sk-client' })).toEqual({
      apiKey: 'sk-server',
      source: 'server',
    })
  })

  it('uses client apiKey when server unset', () => {
    delete process.env.LLM_API_KEY
    expect(resolveLlmApiKeyForRequest({ apiKey: 'sk-client' })).toEqual({
      apiKey: 'sk-client',
      source: 'client',
    })
  })

  it('throws when neither configured', () => {
    delete process.env.LLM_API_KEY
    expect(() => resolveLlmApiKeyForRequest({})).toThrow(/LLM 未配置/)
  })
})

describe('resolveLlmBaseUrl / resolveLlmModel', () => {
  it('uses env overrides', () => {
    process.env.LLM_BASE_URL = 'https://api.siliconflow.cn/v1/'
    process.env.LLM_MODEL = 'deepseek-ai/DeepSeek-V3.2'
    expect(resolveLlmBaseUrl()).toBe('https://api.siliconflow.cn/v1')
    expect(resolveLlmModel()).toBe('deepseek-ai/DeepSeek-V3.2')
  })
})
