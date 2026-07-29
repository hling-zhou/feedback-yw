/**
 * 从 Git 生成更新动态 JSON：public/config/whats-new.json
 * 范围：scripts/whats-new.since .. HEAD（不含 since）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  commitToWhatsNewItem,
  truncateWhatsNewItems,
} from '../src/domain/whatsNewFeed.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const sincePath = join(__dirname, 'whats-new.since')
const outPath = join(root, 'public/config/whats-new.json')
const MAX_ITEMS = 200

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
function git(command, args) {
  return execFileSync('git', [command, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/**
 * @returns {string | null}
 */
function readSince() {
  if (!existsSync(sincePath)) return null
  const line = readFileSync(sincePath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean)
  return line || null
}

/**
 * @param {string} since
 * @returns {{ hash: string; date: string; subject: string; body: string }[]}
 */
export function listCommitsSince(since) {
  const range = `${since}..HEAD`
  const raw = git('log', [
    range,
    '--date=short',
    '--pretty=format:%H%x1f%ad%x1f%s%x1f%b%x1e',
  ])
  if (!raw) return []
  return raw
    .split('\x1e')
    .map((chunk) => chunk.replace(/^\n+/, '').trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash = '', date = '', subject = '', body = ''] = chunk.split('\x1f')
      return {
        hash: hash.trim(),
        date: date.trim(),
        subject: subject.trim(),
        body: body.trim(),
      }
    })
    .filter((c) => c.hash && c.subject)
}

/**
 * @param {{
 *   since: string | null
 *   commits: { hash: string; date: string; subject: string; body: string }[]
 *   repoCommit: string | null
 *   repoUrl?: string | null
 *   now?: string
 * }} input
 */
export function buildWhatsNewFeed(input) {
  const repoUrl = String(input.repoUrl || '').replace(/\/$/, '')
  const items = truncateWhatsNewItems(
    input.commits
      .map((commit) =>
        commitToWhatsNewItem({
          ...commit,
          commitUrl: repoUrl ? `${repoUrl}/commit/${commit.hash}` : null,
        }),
      )
      .filter(Boolean),
    MAX_ITEMS,
  )
  return {
    generatedAt: input.now || new Date().toISOString(),
    source: 'git',
    since: input.since || '',
    repoCommit: input.repoCommit || '',
    items,
  }
}

function main() {
  const since = readSince()
  let repoCommit = ''
  /** @type {{ hash: string; date: string; subject: string; body: string }[]} */
  let commits = []

  try {
    repoCommit = git('rev-parse', ['HEAD'])
  } catch {
    console.warn('[generate:whats-new] no git repo; writing empty feed')
  }

  if (!since) {
    console.warn('[generate:whats-new] missing scripts/whats-new.since; writing empty feed')
  } else if (repoCommit) {
    try {
      commits = listCommitsSince(since)
    } catch (err) {
      console.warn(
        '[generate:whats-new] git log failed:',
        err instanceof Error ? err.message : err,
      )
      commits = []
    }
  }

  const feed = buildWhatsNewFeed({
    since,
    commits,
    repoCommit,
    repoUrl: process.env.WHATS_NEW_REPO_URL || '',
  })

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(feed, null, 2)}\n`, 'utf8')
  console.log(
    `Wrote ${outPath} (since=${since || '∅'}, items=${feed.items.length}, head=${repoCommit.slice(0, 7) || '∅'})`,
  )
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) main()
