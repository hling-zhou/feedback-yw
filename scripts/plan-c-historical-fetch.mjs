#!/usr/bin/env node
/**
 * Plan C 历史数据补拉（一次性脚本）。
 * 连接 IMAP 拉取 2026-11-11 以来的全部邮件，按邮件正文中「数据日期」分组，
 * 对 2026-11-11 至 2026-11-15 的每一日，通过 setImapClientFactory 注入对应
 * 邮件后调用 runPatrolEmailIngestion({ force: true }) 走完整解析+入库链。
 *
 * 用法: node scripts/plan-c-historical-fetch.mjs [--dry-run]
 *   dry-run: 只列出数据日与邮件分布，不入库
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const DRY_RUN = process.argv.includes('--dry-run')

// ---------- env
function loadEnvFile() {
  const envPath = process.env.PLAN_C_ENV_FILE || path.join(REPO_ROOT, '.env-plan-c')
  if (!fs.existsSync(envPath)) {
    console.error('[historical] .env-plan-c 缺失')
    process.exit(2)
  }
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnvFile()

const LOCAL_DB = process.env.PLAN_C_LOCAL_DB || path.join(REPO_ROOT, 'server', 'data', 'plan-c-local.db')
const IMAP_AUTH_CODE = process.env.PLAN_C_IMAP_AUTH_CODE || ''
if (!IMAP_AUTH_CODE) {
  console.error('[historical] 缺 PLAN_C_IMAP_AUTH_CODE')
  process.exit(2)
}

// DB 路径必须在 import server 模块之前设置（db.js 单例）
process.env.AUTH_DATABASE_PATH = LOCAL_DB
process.env.SERVER_DATA_DIR = path.dirname(LOCAL_DB)
fs.mkdirSync(path.dirname(LOCAL_DB), { recursive: true })

const log = (msg) => console.log(`[historical] ${msg}`)

// ---------- data date extraction (与 patrolEmailIngestion.js 同款)
function stripHtmlTags(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function extractDataDateFromHtml(html) {
  const text = stripHtmlTags(html)
  // YYYY-MM-DD 格式（如 2026-11-16）
  let m = /数据日期[：:]\s*(\d{4}-\d{2}-\d{2})/.exec(text)
  if (m) return m[1]
  // MM月DD日 格式（如 11月11日）——早期邮件仅标注月日，按当年补全
  m = /数据日期[：:]\s*(\d{1,2})月(\d{1,2})日/.exec(text)
  if (m) {
    const year = new Date().getFullYear()
    return `${year}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
  }
  return null
}

// ---------- IMAP fetch
const IMAP_DEFAULTS = {
  host: 'imap.cmss.chinamobile.com',
  port: 993,
  user: 'zhouhuiling@cmss.chinamobile.com',
  tls: true,
}

async function fetchHistoricalEmails() {
  const { ImapFlow } = await import('imapflow')
  const client = new ImapFlow({
    host: IMAP_DEFAULTS.host,
    port: IMAP_DEFAULTS.port,
    secure: IMAP_DEFAULTS.tls,
    auth: { user: IMAP_DEFAULTS.user, pass: IMAP_AUTH_CODE },
    logger: false,
  })
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      // 搜 11-11 00:00 以来的全部邮件
      const since = new Date('2026-11-11T00:00:00+08:00')
      const uids = await client.search({ since })
      log(`IMAP 搜索 since 2026-11-11 → ${uids?.length || 0} 封邮件`)
      if (!uids || uids.length === 0) return []

      /** @type {Array<{ raw: string, receivedAt: Date }>} */
      const messages = []
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true })
        if (!msg?.source) continue
        messages.push({
          raw: msg.source.toString('utf-8'),
          receivedAt: msg.envelope?.date ? new Date(msg.envelope.date) : new Date(),
        })
      }
      return messages
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => client.disconnect())
  }
}

// ---------- 按数据日分组
async function groupByDataDate(emails) {
  const { simpleParser } = await import('mailparser')
  /** @type {Map<string, Array<{ raw: string, receivedAt: Date }>>} */
  const groups = new Map()
  for (const email of emails) {
    try {
      const parsed = await simpleParser(email.raw)
      const html = typeof parsed.html === 'string' ? parsed.html : ''
      const dataDate = extractDataDateFromHtml(html)
      if (!dataDate) {
        log(`skip: 未识别数据日 subject="${String(parsed.subject || '').slice(0, 60)}"`)
        continue
      }
      if (!groups.has(dataDate)) groups.set(dataDate, [])
      groups.get(dataDate).push(email)
    } catch (err) {
      log(`skip: MIME 解析失败 ${err.message}`)
    }
  }
  return groups
}

// ---------- main
async function main() {
  // ① 拉 IMAP
  log('连接 IMAP 拉取历史邮件...')
  const emails = await fetchHistoricalEmails()
  log(`拉取完成：共 ${emails.length} 封`)

  // ② 按数据日分组
  log('解析邮件并提取数据日...')
  const groups = await groupByDataDate(emails)
  const allDates = [...groups.keys()].sort()
  log(`数据日分布: ${allDates.join(', ')}`)

  const targetDates = ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']

  // dry-run: 只展示
  if (DRY_RUN) {
    for (const dd of targetDates) {
      const batch = groups.get(dd)
      if (batch) {
        log(`${dd}: ${batch.length} 封邮件（受理时间 ${batch.map(e => e.receivedAt.toISOString().slice(0, 19)).join(', ')}）`)
      } else {
        log(`${dd}: 无邮件 ── 跳过`)
      }
    }
    log('dry-run 完成（未入库）')
    return
  }

  // ③ 逐日入库（通过 runPatrolEmailIngestion 完整链路）
  log('开始逐日入库...')
  const { getDb, closeDb } = await import('../server/db.js')
  getDb()
  const { initBusinessSchema } = await import('../server/businessDb.js')
  initBusinessSchema()
  const { setImapClientFactory, runPatrolEmailIngestion } = await import('../server/patrolEmailIngestion.js')

  /** @type {{ date: string, stats: number, requests: number, error?: string }[]} */
  const results = []

  for (const dataDate of targetDates) {
    const batch = groups.get(dataDate)
    if (!batch || batch.length === 0) {
      log(`${dataDate}: 无邮件 ── 跳过`)
      results.push({ date: dataDate, stats: 0, requests: 0, error: 'no_email' })
      continue
    }

    // 取最新一封（同 runPatrolEmailIngestion 逻辑）
    batch.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
    const email = batch[0]

    // 注入 mock IMAP 工厂，返回这一封邮件
    setImapClientFactory(() => ({
      connect: async () => {},
      searchAndFetch: async () => [{ raw: email.raw, receivedAt: email.receivedAt }],
      disconnect: async () => {},
    }))

    try {
      const result = await runPatrolEmailIngestion({ trigger: 'manual', force: true })
      const stats = result.lastStats
      log(`${dataDate}: ${result.lastResult}${stats ? ` stats=${stats.statsRows} requests=${stats.requestRows} dataDate=${stats.dataDate}` : ''}`)
      results.push({
        date: dataDate,
        stats: stats?.statsRows || 0,
        requests: stats?.requestRows || 0,
        ...(result.lastResult !== 'success' ? { error: result.lastResult } : {}),
      })
    } catch (err) {
      log(`${dataDate}: 异常 ${err.message}`)
      results.push({ date: dataDate, stats: 0, requests: 0, error: err.message })
    }

    // 每轮清理 mock，保证下一轮 fresh
    setImapClientFactory(null)
  }

  closeDb()

  // ④ 汇总
  log('========================================')
  log('汇总:')
  let totalStats = 0
  let totalRequests = 0
  for (const r of results) {
    const tag = r.error ? ` ⚠️ ${r.error}` : ''
    log(`  ${r.date}: stats=${r.stats} requests=${r.requests}${tag}`)
    totalStats += r.stats
    totalRequests += r.requests
  }
  log(`  合计: stats=${totalStats} requests=${totalRequests}`)
  log('完成。如需压缩+诊断+推送，运行 scripts/plan-c-daily.mjs --package-only 2026-11-15')
}

main().catch((err) => {
  console.error('[historical] fatal', err)
  process.exitCode = 2
})