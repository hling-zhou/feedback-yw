/**
 * 生成产品规格配置 Excel：public/config/product-catalog/产品规格配置.xlsx
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const jsonPath = join(root, 'public/config/product-catalog/product-catalog.json')
const outPath = join(root, 'public/config/product-catalog/产品规格配置.xlsx')

const catalog = JSON.parse(readFileSync(jsonPath, 'utf8'))

const guideRows = [
  {
    工作表: '（总览）',
    说明: '导入时仅分析「是否启用=是」的产品；工单「产品规格」列须匹配本表规格名称或别名',
    示例: '—',
  },
  {
    工作表: '目标产品',
    说明: '每行一个目标产品。产品Key 唯一；旅程模板Key 对应打标配置中的产品Key（如 eip）',
    示例: 'eip | 弹性公网IP | 是 | eip | 是',
  },
  {
    工作表: '产品规格',
    说明: '每行一个规格，用产品Key 关联。匹配别名：逗号分隔，用于匹配工单「具体投诉产品/产品规格」列',
    示例: 'eip | 弹性公网IP-移动IP | 弹性公网 IP-移动IP',
  },
]

const productRows = (catalog.products || []).map((p) => ({
  产品Key: p.key,
  产品名称: p.name,
  是否启用: p.enabled ? '是' : '否',
  旅程模板Key: p.taxonomyKey || p.key,
  接受产品名匹配: p.acceptParentName !== false ? '是' : '否',
}))

const specRows = []
for (const p of catalog.products || []) {
  for (const s of p.specs || []) {
    specRows.push({
      产品Key: p.key,
      规格名称: s.name,
      匹配别名: (s.match || []).join(','),
    })
  }
}

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(guideRows), '填写说明')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productRows), '目标产品')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(specRows), '产品规格')

writeFileSync(outPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
console.log('Wrote', outPath)
console.log(`  目标产品 ${productRows.length} 行，产品规格 ${specRows.length} 行`)
