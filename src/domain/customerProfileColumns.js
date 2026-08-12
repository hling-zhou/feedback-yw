/** 工单导入/导出：客户基础信息列（sourceColumns 规范键） */

export const CUSTOMER_PROFILE_SOURCE_COLUMNS = /** @type {const} */ ([
  '客户类型名称',
  '集团名称',
  '集团客户编码',
  '集团所属省份',
  '集团所属地市',
  '登录账号名称',
  '移动云客户服务等级',
  '受理渠道',
])

/** @typedef {typeof CUSTOMER_PROFILE_SOURCE_COLUMNS[number]} CustomerProfileSourceColumn */

/** 导入映射字段 key → sourceColumns 规范键 */
export const CUSTOMER_PROFILE_IMPORT_FIELD_KEYS = /** @type {const} */ ({
  customerTypeNameCol: '客户类型名称',
  groupNameCol: '集团名称',
  groupCustomerCodeCol: '集团客户编码',
  groupProvinceCol: '集团所属省份',
  groupCityCol: '集团所属地市',
  loginAccountNameCol: '登录账号名称',
})

/** 登录账号：导入兼容「登陆」「登录」两种表头 */
export const LOGIN_ACCOUNT_NAME_HEADER_CANDIDATES = ['登录账号名称', '登陆账号名称']
