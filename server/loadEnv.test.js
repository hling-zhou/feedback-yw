import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadEnvFile } from './loadEnv.js'

describe('loadEnvFile', () => {
  /** @type {string | undefined} */
  let originalValue
  /** @type {string} */
  let tempEnvPath

  beforeEach(() => {
    originalValue = process.env.LOAD_ENV_TEST_KEY
    delete process.env.LOAD_ENV_TEST_KEY
    tempEnvPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-')), '.env')
    fs.writeFileSync(tempEnvPath, 'LOAD_ENV_TEST_KEY=from-dotenv\n# comment\n', 'utf8')
  })

  afterEach(() => {
    if (tempEnvPath && fs.existsSync(tempEnvPath)) {
      fs.rmSync(path.dirname(tempEnvPath), { recursive: true, force: true })
    }
    if (originalValue === undefined) {
      delete process.env.LOAD_ENV_TEST_KEY
    } else {
      process.env.LOAD_ENV_TEST_KEY = originalValue
    }
  })

  it('loads variables from a given .env file without overriding existing env', () => {
    process.env.LOAD_ENV_TEST_KEY = 'preset'
    loadEnvFile({ path: tempEnvPath })
    expect(process.env.LOAD_ENV_TEST_KEY).toBe('preset')

    delete process.env.LOAD_ENV_TEST_KEY
    loadEnvFile({ path: tempEnvPath })
    expect(process.env.LOAD_ENV_TEST_KEY).toBe('from-dotenv')
  })
})
