import * as XLSX from 'xlsx'
import { ROLE_LABELS, ROLES } from '../domain/auth/permissions.js'
import { PASSWORD_POLICY_HINT } from '../domain/passwordPolicy.js'
import { POSITIONS, TEAMS } from '../domain/userProfile.js'

export const USER_IMPORT_SHEET_NAME = '用户列表'

/** 导入模板表头 */
export const USER_IMPORT_TEMPLATE_HEADERS = [
  '用户名*（必填）',
  '密码（留空用默认）',
  '岗位*（必填）',
  '所属班组*（必填）',
  '角色*（必填）',
]

const TEMPLATE_INSTRUCTIONS = [
  ['填写说明'],
  ['每行创建一个登录账号；用户名不可与已有账号重复。'],
  ['密码留空则使用系统统一初始密码，由管理员线下告知本人；填写时须满足策略。'],
  [`密码策略：${PASSWORD_POLICY_HINT}`],
  [`岗位可填：${POSITIONS.join('、')}`],
  ['所属班组可填：'],
  ...TEAMS.map((t) => [`　· ${t}`]),
  [`角色可填：${ROLES.map((r) => ROLE_LABELS[r]).join('、')}`],
  ['岗位与所属班组须与上述选项完全一致，否则该行会被跳过。'],
  ['导入时跳过校验失败的行，成功行仍会创建。'],
]

/**
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

/** 下载空白用户导入模板 */
export function downloadUserImportTemplate() {
  const wb = XLSX.utils.book_new()

  const emptyRow = Object.fromEntries(USER_IMPORT_TEMPLATE_HEADERS.map((h) => [h, '']))
  const listSheet = XLSX.utils.json_to_sheet([emptyRow], {
    header: USER_IMPORT_TEMPLATE_HEADERS,
  })
  XLSX.utils.book_append_sheet(wb, listSheet, USER_IMPORT_SHEET_NAME)

  const guideSheet = XLSX.utils.aoa_to_sheet(TEMPLATE_INSTRUCTIONS)
  XLSX.utils.book_append_sheet(wb, guideSheet, '填写说明')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  triggerDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `用户管理-导入模板-${new Date().toISOString().slice(0, 10)}.xlsx`,
  )
}
