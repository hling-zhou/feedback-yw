import { afterEach, describe, expect, it } from 'vitest'
import {
  getLlmConfigStatus,
  isLlmConfigured,
  maskApiKey,
  normalizeLlmBaseUrl,
  resolveLlmApiKey,
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

describe('maskApiKey', () => {
  it('masks long keys with head and tail', () => {
    expect(maskApiKey('sk-abcdef1234567890')).toBe('sk-a••••7890')
  })
  it('masks short keys fully', () => {
    expect(maskApiKey('sk-ab')).toBe('••••')
    expect(maskApiKey('')).toBe('')
  })
})

describe('isLlmConfigured', () => {
  it('is false without any config', () => {
    delete process.env.LLM_API_KEY
    expect(isLlmConfigured()).toBe(false)
  })

  it('is true when env LLM_API_KEY is set', () => {
    delete process.env.LLM_API_KEY
    process.env.LLM_API_KEY = 'sk-test'
    expect(isLlmConfigured()).toBe(true)
  })
})

describe('resolveLlmApiKey / resolveLlmBaseUrl / resolveLlmModel', () => {
  it('falls back to env when DB unset', () => {
    delete process.env.LLM_API_KEY
    process.env.LLM_API_KEY = 'sk-env'
    process.env.LLM_BASE_URL = 'https://api.siliconflow.cn/v1/'
    process.env.LLM_MODEL = 'deepseek-ai/DeepSeek-V3.2'
    expect(resolveLlmApiKey()).toBe('sk-env')
    expect(resolveLlmBaseUrl()).toBe('https://api.siliconflow.cn/v1')
    expect(resolveLlmModel()).toBe('deepseek-ai/DeepSeek-V3.2')
  })

  it('throws when neither DB nor env configured', () => {
    delete process.env.LLM_API_KEY
    expect(() => resolveLlmApiKey()).toThrow(/未设置 LLM_API_KEY/)
  })
})

describe('getLlmConfigStatus', () => {
  it('reports env source when DB unset', () => {
    delete process.env.LLM_API_KEY
    process.env.LLM_API_KEY = 'sk-envkey-12345678'
    const status = getLlmConfigStatus()
    expect(status.configured).toBe(true)
    expect(status.source).toBe('env')
    expect(status.apiKeyMasked).toBe('sk-e••••5678')
  })

  it('reports none when neither configured', () => {
    delete process.env.LLM_API_KEY
    const status = getLlmConfigStatus()
    expect(status.configured).toBe(false)
    expect(status.source).toBe('none')
    expect(status.apiKeyMasked).toBe('')
  })
})
