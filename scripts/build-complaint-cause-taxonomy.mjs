/**
 * 从 data/附件1 生成 src/data/complaintCauseTaxonomy.json
 * Usage: node scripts/build-complaint-cause-taxonomy.mjs
 */
import XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const xlsxPath = path.join(root, 'data/附件1：移动云投诉原因分类及场景说明-20240828.xlsx')
const outPath = path.join(root, 'src/data/complaintCauseTaxonomy.json')

const wb = XLSX.readFile(xlsxPath)
const sheet = wb.Sheets['投诉原因标签'] || wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

/** @type {Map<string, Map<string, Set<string>>>} */
const tree = new Map()
for (const row of rows) {
  const l1 = String(row['投诉原因（一级）'] ?? '').trim()
  const l2 = String(row['投诉原因 （二级）'] ?? row['投诉原因（二级）'] ?? '').trim()
  const l3 = String(row['投诉原因 （三级）'] ?? row['投诉原因（三级）'] ?? '').trim()
  if (!l1) continue
  if (!tree.has(l1)) tree.set(l1, new Map())
  const l2map = tree.get(l1)
  if (!l2map.has(l2)) l2map.set(l2, new Set())
  if (l3) l2map.get(l2).add(l3)
}

const taxonomy = [...tree.entries()].map(([l1, l2map]) => ({
  label: l1,
  children: [...l2map.entries()].map(([l2, l3set]) => ({
    label: l2,
    children: [...l3set].filter(Boolean).map((label) => ({ label })),
  })),
}))

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(taxonomy, null, 2)}\n`)
console.log(`Wrote ${outPath} (${taxonomy.length} L1, ${rows.length} rows)`)
