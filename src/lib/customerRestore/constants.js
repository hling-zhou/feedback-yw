import {
  CUSTOMER_PROFILE_SOURCE_COLUMNS,
  LOGIN_ACCOUNT_NAME_HEADER_CANDIDATES,
} from '../../domain/customerProfileColumns.js'

/**
 * 临时能力：回填 8 月之前已脱敏工单的客户名称/编码。
 * 8 月及以后源数据会自带这些字段；回填完成后改为 false 即可从反馈库下架入口。
 */
export const CUSTOMER_RESTORE_IMPORT_ENABLED = true

export const CUSTOMER_RESTORE_SESSION_LABEL = '客户信息复原（临时）'

/** 不把「受理渠道」纳入复原表：那不是身份字段 */
export const CUSTOMER_RESTORE_PROFILE_COLUMNS = CUSTOMER_PROFILE_SOURCE_COLUMNS.filter(
  (label) => label !== '受理渠道',
)

export const CUSTOMER_RESTORE_TICKET_HEADER = '工单号'

/** 表头别名 → 规范列名 */
export const CUSTOMER_RESTORE_HEADER_ALIASES = {
  工单号: ['工单号', '工单展示流水号', '工单流水号'],
  集团名称: ['集团名称', '客户名称', '集团客户名称'],
  集团客户编码: ['集团客户编码', '客户编码'],
  客户类型名称: ['客户类型名称'],
  集团所属省份: ['集团所属省份'],
  集团所属地市: ['集团所属地市'],
  登录账号名称: [...LOGIN_ACCOUNT_NAME_HEADER_CANDIDATES],
  移动云客户服务等级: ['移动云客户服务等级', '客户等级'],
}

export const CUSTOMER_RESTORE_TEMPLATE_HEADERS = [
  `${CUSTOMER_RESTORE_TICKET_HEADER}*`,
  ...CUSTOMER_RESTORE_PROFILE_COLUMNS,
]
