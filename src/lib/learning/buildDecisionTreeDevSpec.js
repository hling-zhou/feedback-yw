import { TAG_CORRECTION_DIMENSION_LABELS } from './constants.js'
import { parseJourneyPair } from './journeyLabel.js'

const SCENE_FILES = [
  'src/lib/requestSceneClassifier.js',
  'src/lib/requestSceneClassifier.test.js',
]

const TYPE_FILES = [
  'src/lib/problemTypeClassifier.js',
  'src/lib/problemTypeClassifier.test.js',
]

/**
 * @param {string} productKey
 */
function journeyFiles(productKey) {
  const key = productKey || 'generic'
  return [`src/lib/journeys/${key}Journey.js`, `src/lib/journeys/${key}Journey.calibration.test.js`]
}

/**
 * @param {import('./tagCorrectionRules.js').TagCorrectionRule} rule
 */
export function targetFilesForCorrection(rule) {
  if (rule.dimension === 'requestScene') return SCENE_FILES
  if (rule.dimension === 'problemType') return TYPE_FILES
  return journeyFiles(rule.productKey)
}

/**
 * @param {import('./tagCorrectionRules.js').TagCorrectionRule} rule
 * @param {{ productName?: string }} [opts]
 */
export function buildDecisionTreeDevSpec(rule, opts = {}) {
  const dimLabel = TAG_CORRECTION_DIMENSION_LABELS[rule.dimension] || rule.dimension
  const files = targetFilesForCorrection(rule)
  const samples = (rule.samples || []).slice(0, 5)
  const keywords = (rule.keywords || []).join('、') || '（无）'
  const product = opts.productName || rule.productKey || '通用'
  const journey = rule.dimension === 'journey' ? parseJourneyPair(rule.toLabel) : null

  const sampleLines = samples.length
    ? samples
        .map(
          (s, i) =>
            `${i + 1}. \`${s.recordId}\`：${String(s.taggingText || '').replace(/\s+/g, ' ').slice(0, 180)} → 期望 **${rule.toLabel}**，不得为 **${rule.fromLabel}**`,
        )
        .join('\n')
    : '（暂无摘录，请从改标学习证据工单补齐）'

  return [
    `# [打标决策树] ${dimLabel}：${rule.fromLabel} → ${rule.toLabel}`,
    '',
    '## 背景',
    '',
    `- 产品：${product}`,
    `- 维度：${dimLabel}`,
    `- 证据条数：${rule.evidenceCount || 0}`,
    `- 跨月数：${rule.distinctMonths || 0}`,
    `- 已批准关键词：${keywords}`,
    '',
    '## 现状',
    '',
    `决策树先命中「${rule.fromLabel}」，对象与标签关键词 / overlay 无法从根上纠正。需要在决策树中为「${rule.toLabel}」补命中条件，并在「${rule.fromLabel}」增加排除。`,
    '',
    '## 目标文件',
    '',
    ...files.map((f) => `- \`${f}\``),
    '',
    '## 建议改法',
    '',
    `- 在「${rule.toLabel}」分支增加命中条件（优先使用已批准关键词：${keywords}）`,
    `- 在「${rule.fromLabel}」增加排除，避免同类文本再次先命中错误分支`,
    ...(journey ? [`- 旅程节点：${journey.journeyL1} > ${journey.journeyL2}`] : []),
    '',
    '## 校准用例',
    '',
    sampleLines,
    '',
    '## 验收',
    '',
    `- 关闭 overlay 时，新导入同类文本打成「${rule.toLabel}」`,
    '- 已有 `preserveManualTags` 工单不被改写',
    '- 补齐对应 classifier / calibration 测试',
    '',
    '## 建议撤销',
    '',
    '代码合入并校准通过后，在「对象与标签 → 改标学习」将对应 overlay 标为可移除（已补决策树）。',
  ].join('\n')
}
