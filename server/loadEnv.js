import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

let loaded = false

/**
 * 从项目根目录加载 `.env`（不覆盖已存在的 process.env）。
 * @param {{ path?: string }} [options]
 */
export function loadEnvFile(options = {}) {
  if (loaded && !options.path) return
  if (!options.path) loaded = true

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const envPath = options.path ?? path.join(root, '.env')
  if (!fs.existsSync(envPath)) return

  const text = fs.readFileSync(envPath, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue

    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadEnvFile()
