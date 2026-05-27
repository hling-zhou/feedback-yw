/**
 * 生成打标配置 Excel：public/config/taxonomy/打标配置.xlsx
 */
import { writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outPath = join(root, 'public/config/taxonomy/打标配置.xlsx')

const EXAMPLE_NODE =
  'undefined--弹性公网IP--产品使用问题--公网IP绑定/解绑失败'

function loadJson(name) {
  return JSON.parse(readFileSync(join(root, `public/config/taxonomy/${name}.json`), 'utf8'))
}

function buildJourneyIndex(journeys) {
  const l1ById = new Map()
  const l2ById = new Map()
  for (const l1 of journeys || []) {
    l1ById.set(l1.id, l1.label)
    for (const l2 of l1.children || []) {
      l2ById.set(l2.id, { l1Id: l1.id, l1Name: l1.label, l2Name: l2.label })
    }
  }
  return { l1ById, l2ById }
}

const eip = loadJson('eip')
const generic = loadJson('generic')
const products = [eip, generic]
const eipJourneyIdx = buildJourneyIndex(eip.journeys)

const guideRows = [
  {
    工作表: '（总览）',
    适用产品: '全部',
    用途与填写要点:
      '一个工作簿维护多产品；各行用「产品Key」区分。新增产品：产品识别 → 用户旅程 →（可选）请求节点两张表',
    示例: '—',
  },
  {
    工作表: '产品识别',
    适用产品: '每产品一行',
    用途与填写要点: '产品Key、产品名称、匹配关键词（逗号分隔）',
    示例: 'eip | 弹性公网 IP | 弹性公网,公网IP,EIP',
  },
  {
    工作表: '用户旅程',
    适用产品: '按产品Key 多行',
    用途与填写要点:
      '一级/二级 ID·名称·说明、参考关键词。旅程打标与主题标签均只维护本表（必填）',
    示例: 'eip | bind | 绑定与网络配置 | … | bind-resource | 绑定/解绑云资源 | …',
  },
  {
    工作表: '通用问题类型',
    适用产品: '全平台共用',
    用途与填写要点: '无产品Key。问题类型名称、说明、参考关键词',
    示例: '可用性/连通性 | 连通、中断类问题 | 不通,无法访问',
  },
  {
    工作表: '请求节点-服务类型',
    适用产品: '可选；按产品Key',
    用途与填写要点:
      '【弱参考·精确匹配】列「请求节点服务类型」须与工单路径第3段完全一致；一级ID/名称须存在于「用户旅程」。默认不用请求节点，仅设置中开启兜底且正文未识别时生效',
    示例: `工单：请求节点：${EXAMPLE_NODE} → 第3段「产品使用问题」填本表`,
  },
  {
    工作表: '请求节点-问题子类',
    适用产品: '可选；按产品Key',
    用途与填写要点:
      '【弱参考·精确匹配】列「请求节点问题子类」须与工单路径最后一段完全一致；二级ID 须为该一级下存在的环节',
    示例: `同上工单 → 最后一段「公网IP绑定/解绑失败」填本表`,
  },
  {
    工作表: '（示例·路径拆分）',
    适用产品: '—',
    用途与填写要点: '请求节点：undefined--弹性公网IP--产品使用问题--公网IP绑定/解绑失败',
    示例:
      '段1 undefined（忽略）| 段2 弹性公网IP（产品段）| 段3 产品使用问题→「请求节点-服务类型」| 段4 公网IP绑定/解绑失败→「请求节点-问题子类」',
  },
  {
    工作表: '（示例·请求节点-服务类型）',
    适用产品: 'eip',
    用途与填写要点: '产品Key | 请求节点服务类型 | 一级ID | 一级名称',
    示例: 'eip | 产品使用问题 | operate | 日常运维与访问',
  },
  {
    工作表: '（示例·请求节点-问题子类）',
    适用产品: 'eip',
    用途与填写要点: '产品Key | 请求节点问题子类 | 一级ID | 一级名称 | 二级ID | 二级名称',
    示例:
      'eip | 公网IP绑定/解绑失败 | bind | 绑定与网络配置 | bind-resource | 绑定/解绑云资源',
  },
  {
    工作表: '（说明）',
    适用产品: '—',
    用途与填写要点:
      '请求节点常不准确；主流程以处理意见/客户问题/LLM 为准。两表不做语义模糊匹配，只按原文对照',
    示例: '—',
  },
]

const productRows = products.map((p) => ({
  产品Key: p.key,
  产品名称: p.name,
  匹配关键词: (p.match || []).join(','),
}))

const journeyRows = []
for (const p of products) {
  for (const l1 of p.journeys || []) {
    for (const l2 of l1.children || []) {
      journeyRows.push({
        产品Key: p.key,
        一级ID: l1.id,
        一级名称: l1.label,
        一级说明: l1.description || '',
        二级ID: l2.id,
        二级名称: l2.label,
        二级说明: l2.description || '',
        参考关键词: (l2.keywords || []).join(','),
      })
    }
  }
}

const problemTypeMap = new Map()
for (const p of products) {
  for (const pt of p.problemTypes || []) {
    if (!problemTypeMap.has(pt.label)) {
      problemTypeMap.set(pt.label, {
        问题类型名称: pt.label,
        问题类型说明: '',
        参考关键词: (pt.keywords || []).join(','),
      })
    }
  }
}
const problemRows = [...problemTypeMap.values()]

const serviceRows = []
const issueRows = []
const serviceKeys = new Set()
const issueKeys = new Set()

if (eip.nodeMaps) {
  for (const [k, l1Id] of Object.entries(eip.nodeMaps.serviceMap || {})) {
    serviceKeys.add(k)
    serviceRows.push({
      产品Key: 'eip',
      请求节点服务类型: k,
      一级ID: l1Id,
      一级名称: eipJourneyIdx.l1ById.get(l1Id) || '',
    })
  }
  for (const [k, v] of Object.entries(eip.nodeMaps.issueMap || {})) {
    issueKeys.add(k)
    const l2 = eipJourneyIdx.l2ById.get(v.l2)
    issueRows.push({
      产品Key: 'eip',
      请求节点问题子类: k,
      一级ID: v.l1,
      一级名称: eipJourneyIdx.l1ById.get(v.l1) || l2?.l1Name || '',
      二级ID: v.l2 || '',
      二级名称: l2?.l2Name || '',
    })
  }
}

if (!serviceKeys.has('产品使用问题')) {
  serviceRows.push({
    产品Key: 'eip',
    请求节点服务类型: '产品使用问题',
    一级ID: 'operate',
    一级名称: eipJourneyIdx.l1ById.get('operate') || '日常运维与访问',
  })
}
if (!issueKeys.has('公网IP绑定/解绑失败')) {
  issueRows.push({
    产品Key: 'eip',
    请求节点问题子类: '公网IP绑定/解绑失败',
    一级ID: 'bind',
    一级名称: '绑定与网络配置',
    二级ID: 'bind-resource',
    二级名称: '绑定/解绑云资源',
  })
}

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(guideRows), '填写说明')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productRows), '产品识别')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(journeyRows), '用户旅程')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(problemRows), '通用问题类型')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(serviceRows), '请求节点-服务类型')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(issueRows), '请求节点-问题子类')

writeFileSync(outPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
console.log('已生成', outPath)
