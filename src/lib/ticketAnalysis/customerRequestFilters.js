/** 客服/后端内部流转话术（非客户视角业务诉求） */
import { stripInternalWorkflowPrefix } from './workflowTextCleanup.js'

const INTERNAL_CS_BACKEND_RE = [
  /请(?:网络|安全|应用|产品|后端|协查|计算)[^，,。]{0,20}(?:抓包|排查|协查|处理|定位)/,
  /已返单/,
  /建群(?:处理|反馈|协查)?/,
  /已建临时群/,
  /请服务台拉群/,
  /工单保留/,
  /暂未回复/,
  /待客户(?:补充|回复|提供)/,
  /已联系客户[，,]?客户表示稍后/,
  /请扫码进群/,
  /已指导客户/,
  /已协助客户/,
  /已RAM授权/,
  /授权后台处理/,
  /请客户验证/,
  /回单口径/,
  /请提供MTR截图/,
]

/** 句内删除的指令短句（保留前面的客户诉求） */
const INTERNAL_INSTRUCTION_SNIPPETS = [
  /请(?:网络|安全|应用|产品|后端|计算)组?(?:抓包|排查|协查|处理|定位)/g,
  /请协助处理/g,
  /烦请后台跟进/g,
  /请服务台拉群/g,
  /已建临时群/g,
  /请提供MTR截图/g,
  /请客户验证/g,
  /回单口径/g,
  /已RAM授权/g,
  /授权后台处理/g,
]

const CUSTOMER_VOICE_LEAD_RE =
  /^(?:\d+[、.．]\s*)?(?:【)?(?:客户反馈|用户反馈|客户表示|用户表示|客户补充|客户原话|客户咨询|客户问题|客户需求)(?:】)?[：:，,\s]*/

const CUSTOMER_DEMAND_HINT =
  /(?:无法|不能|报错|失败|希望|需要|咨询|申请|加急|投诉|故障|不通|异常|打不开|慢|丢包|绑定|开通|退订|升降配|请问|如何|怎么|为什么|帮忙|排查|转移|放开|端口)/

/**
 * @param {string} text
 */
export function isInternalCsBackendText(text) {
  const t = (text || '').trim()
  if (!t) return true
  if (CUSTOMER_DEMAND_HINT.test(t) && t.length > 12) return false
  return INTERNAL_CS_BACKEND_RE.some((re) => re.test(t))
}

/**
 * @param {string} text
 */
export function isCustomerDemandLike(text) {
  const t = cleanCustomerRequestPhrase(text)
  if (!t || t.length < 2) return false
  if (CUSTOMER_DEMAND_HINT.test(t)) return true
  if (/客户|用户/.test(t) && t.length <= 120) return true
  return t.length >= 4 && t.length <= 120
}

/**
 * 句内删除内部指令短句，保留客户诉求正文
 * @param {string} text
 */
export function stripInternalInstructionPhrases(text) {
  let t = (text || '').trim()
  if (!t) return ''
  for (const re of INTERNAL_INSTRUCTION_SNIPPETS) {
    t = t.replace(re, '')
  }
  return t.replace(/[，,；;]{2,}/g, '，').replace(/^[，,；;\s]+|[，,；;\s]+$/g, '').trim()
}

/**
 * 清洗单条客户诉求表述：去组前缀、去「客户反馈」引导语、去内部指令
 * @param {string} text
 */
export function cleanCustomerRequestPhrase(text) {
  let t = stripInternalWorkflowPrefix(text)
  t = stripInternalInstructionPhrases(t)
  t = t.replace(CUSTOMER_VOICE_LEAD_RE, '').trim()
  t = t.replace(/^["「『]|["」』]$/g, '').trim()
  return t
}

/** 工单格式化模板字段名（非客户诉求） */
const TEMPLATE_FIELD_NAMES_RE =
  /(?:请求节点|系统路径|工单标题|详细内容|受理内容|咨询内容|处理意见|客户标签|联系时间|问题原因|受理渠道|解决方案|根因|归档意见|回复内容)/g

/**
 * 判断文本是否为工单格式化模板内容（如"请求节点：全局流转--业务规则咨询/查询-全局流转工单标题：业务规则咨询/查询-全局流转详细内容："）
 * 模板特征：多个字段名堆叠，实际客户诉求内容占比极低。
 * @param {string} text
 */
export function isFormattedTemplateContent(text) {
  const t = (text || '').trim()
  if (!t || t.length < 8) return false
  const matches = t.match(TEMPLATE_FIELD_NAMES_RE)
  if (!matches || matches.length < 2) return false
  const stripped = t.replace(TEMPLATE_FIELD_NAMES_RE, '').replace(/[：:\s\-\—/\/]/g, '').trim()
  const ratio = stripped.length / t.length
  return ratio < 0.6
}
