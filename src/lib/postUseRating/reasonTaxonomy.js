/**
 * 用后即评固定原因清单（PRD §3.10 / task9 控制台 + 投诉回访）
 */

/** 控制台评分类（18 项，含「其他」） */
export const CONSOLE_REASON_TAXONOMY = [
  '功能有缺失',
  '任务操作流程不够简单快捷',
  '缺乏操作指引',
  '不满足业务部署要求',
  '内容/帮助说明不易懂',
  '稳定性不足故障频发',
  '页面打开慢',
  '界面布局不合理',
  '帮助文档说明不清晰',
  '服务不好用/操作过于复杂',
  '找不到需要的产品/功能',
  '存在网络安全问题或风险',
  '自助解决支撑不足',
  '内容/帮助说明不充分',
  '产品价格没有优势',
  '购买时参数/配置选择错误',
  '服务故障频发/无法修复',
  '其他',
]

/** 投诉回访类（6 项，含「其他」） */
export const CALLBACK_REASON_TAXONOMY = [
  '未解决',
  '处理周期长',
  '业务规则',
  '产品质量',
  '服务人员的业务能力',
  '其他',
]

/** 柱状图展示排除标签 */
export const REASON_TAXONOMY_EXCLUDE = new Set(['其他', '业务使用完毕', '空白'])

/**
 * @param {string | null | undefined} text
 * @param {string | null | undefined} channel console | callback | sms | …
 * @returns {{ reasonKey: string; label: string } | null}
 */
export function matchReasonTaxonomy(text, channel) {
  return matchAllReasonTaxonomy(text, channel)[0] || null
}

/** Multi-label matching. Evidence may express several needs in one answer. */
export function matchAllReasonTaxonomy(text, channel) {
  const corpus = String(text ?? '')
  if (!corpus) return []
  const ch = String(channel ?? '').trim().toLowerCase()
  const list = ch === 'callback' ? CALLBACK_REASON_TAXONOMY : CONSOLE_REASON_TAXONOMY
  return list
    .filter((label) => label !== '其他' && corpus.includes(label))
    .map((label) => ({ reasonKey: label, label }))
}
