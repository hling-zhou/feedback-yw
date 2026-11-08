// DB 隔离（db.js 模块顶层即算路径——必须先设环境变量再动态 import，
// 否则落到 server/data/auth.db 真库：真库若已配置 llm_config_v1（设置页保存），
// 「DB unset 走 env 回退」类用例必失败（11-08 会诊 C 升级回归时坐实）。
process.env.AUTH_DATABASE_PATH = `/tmp/fi-llmconfig-test-${process.pid}.db`
import { rmSync } from 'node:fs'
rmSync(process.env.AUTH_DATABASE_PATH, { force: true })

const { getDb, closeDb } = await import('./db.js')
getDb() // 空库初始化（无 llm_config_v1 → 走 env 回退语义成立）
const llmConfig = await import('./llmConfig.js')
const {
  getLlmConfigStatus,
  isLlmConfigured,
  maskApiKey,
  normalizeLlmBaseUrl,
  resolveLlmApiKey,
  resolveLlmBaseUrl,
  resolveLlmModel,
} = llmConfig

import { afterAll, afterEach, describe, expect, it } from 'vitest'

const envBackup = { ...process.env }

afterEach(() => {
  process.env = { ...envBackup }
})

afterAll(async () => {
  await closeDb()
  rmSync(process.env.AUTH_DATABASE_PATH, { force: true })
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
