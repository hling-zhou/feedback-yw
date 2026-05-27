/**
 * 从 auth.db 导出 productKey=vpc 工单，统计旅程分布与请求节点，用于校准 vpcJourney。
 *
 * 用法：node scripts/analyzeVpcJourneyCalibration.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { matchJourneyByDescription } from '../src/lib/ticketTagging.js'
import { initTaxonomyCacheFromBuiltin, getProductByKey } from '../src/lib/taxonomyLoader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dbPath = path.join(root, 'server/data/auth.db')
const exportPath = path.join(root, 'server/data/_vpc_export.jsonl')

if (!fs.existsSync(exportPath)) {
  execSync(
    `sqlite3 "${dbPath}" "SELECT payload FROM records WHERE payload LIKE '%\\"productKey\\":\\"vpc\\"%';" > "${exportPath}"`,
    { stdio: 'inherit' },
  )
}

initTaxonomyCacheFromBuiltin()
const vpcJourneys = getProductByKey('vpc').journeys
const lines = fs.readFileSync(exportPath, 'utf8').trim().split('\n').filter(Boolean)
const records = lines.map((l) => JSON.parse(l))

const rematch = {}
for (const r of records) {
  const text = `${r.handlingText || ''} ${r.rawText || ''} ${r.responseText || ''}`
  const m = matchJourneyByDescription(text, vpcJourneys, 'vpc')
  const k = `${m.journeyL1} > ${m.journeyL2}`
  rematch[k] = (rematch[k] || 0) + 1
}

console.log(`vpc_records ${records.length}`)
console.log('keyword_rematch:')
for (const [k, c] of Object.entries(rematch).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c}\t${k}`)
}
