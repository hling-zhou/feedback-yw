/**
 * 将高频、跨周期稳定的「确立举措」沉淀到 public/config/planning/playbook.json
 *
 * 条件（与运行时群组合成阈值对齐）：
 * - 同一 product + journeyL2 + problemType 下，相同举措文本 ≥ 3 单
 * - 关联工单 createdAt/updatedAt 覆盖 ≥ 2 个 distinct 月份（跨周期）
 *
 * 用法：
 *   node scripts/promote-established-actions-to-playbook.mjs
 *   node scripts/promote-established-actions-to-playbook.mjs --dry-run
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from '../server/db.js'
import { storageRepository } from '../server/storageRepository.js'
import {
  aggregateEstablishedActionsFromRecords,
  CLUSTER_ESTABLISHED_ACTION_MIN_TICKETS,
  PLAYBOOK_PROMOTION_MIN_DISTINCT_MONTHS,
} from '../src/lib/painPointClustering/clusterEstablishedActionCorpus.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const playbookPath = join(root, 'public/config/planning/playbook.json')

const dryRun = process.argv.includes('--dry-run')

/**
 * @param {unknown} value
 * @returns {import('../src/lib/planningConfigLoader.js').PlanningPlaybookConfig}
 */
function loadPlaybook(value) {
  if (value && typeof value === 'object') {
    return /** @type {import('../src/lib/planningConfigLoader.js').PlanningPlaybookConfig} */ (value)
  }
  return { version: 0, journeys: {}, problemTypes: {}, products: {} }
}

/**
 * @param {import('../src/lib/planningConfigLoader.js').PlanningPlaybookConfig} playbook
 * @param {{ product: string; journeyL2: string; problemType: string; text: string }} row
 */
function mergeCandidateIntoPlaybook(playbook, row) {
  const product = row.product?.trim()
  const journeyL2 = row.journeyL2?.trim()
  const problemType = row.problemType?.trim()
  const text = row.text?.trim()
  if (!product || !text) return false

  if (!playbook.products) playbook.products = {}
  if (!playbook.products[product]) {
    playbook.products[product] = { journeys: {}, problemTypes: {} }
  }
  const bucket = playbook.products[product]
  if (!bucket.journeys) bucket.journeys = {}
  if (!bucket.problemTypes) bucket.problemTypes = {}

  let added = false
  if (journeyL2 && !/未知|未识别/.test(journeyL2)) {
    if (!bucket.journeys[journeyL2]) bucket.journeys[journeyL2] = []
    if (!bucket.journeys[journeyL2].includes(text)) {
      bucket.journeys[journeyL2].push(text)
      added = true
    }
  }
  if (problemType) {
    if (!bucket.problemTypes[problemType]) bucket.problemTypes[problemType] = []
    if (!bucket.problemTypes[problemType].includes(text)) {
      bucket.problemTypes[problemType].push(text)
      added = true
    }
  }
  return added
}

function main() {
  getDb()
  const { records } = storageRepository.listRecords({})
  const candidates = aggregateEstablishedActionsFromRecords(records, {
    minCount: CLUSTER_ESTABLISHED_ACTION_MIN_TICKETS,
    minDistinctMonths: PLAYBOOK_PROMOTION_MIN_DISTINCT_MONTHS,
  })

  const existing = loadPlaybook(JSON.parse(readFileSync(playbookPath, 'utf8')))
  const playbook = loadPlaybook(JSON.parse(JSON.stringify(existing)))

  /** @type {typeof candidates} */
  const promoted = []
  for (const row of candidates) {
    if (mergeCandidateIntoPlaybook(playbook, row)) promoted.push(row)
  }

  if (promoted.length) {
    playbook.version = Number(existing.version || 0) + 1
  }

  console.log(
    `扫描工单 ${records.length} 条；候选 ${candidates.length} 条；新增 playbook 条目 ${promoted.length} 条（阈值：≥${CLUSTER_ESTABLISHED_ACTION_MIN_TICKETS} 单、≥${PLAYBOOK_PROMOTION_MIN_DISTINCT_MONTHS} 月）。`,
  )

  for (const row of promoted) {
    console.log(
      `  + [${row.product}] ${row.journeyL2 || '—'} / ${row.problemType || '—'} · ${row.count}单 · ${row.distinctMonths}月 · ${row.text.slice(0, 60)}${row.text.length > 60 ? '…' : ''}`,
    )
  }

  if (!promoted.length) {
    console.log('无新增，playbook 未变更。')
    return
  }

  if (dryRun) {
    console.log('\n--dry-run：未写入文件。')
    console.log(JSON.stringify(playbook, null, 2))
    return
  }

  writeFileSync(playbookPath, `${JSON.stringify(playbook, null, 2)}\n`, 'utf8')
  console.log(`已写入 ${playbookPath}（version ${playbook.version}）`)
}

main()
