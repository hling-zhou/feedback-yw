import * as XLSX from 'xlsx'
import { ROLE_LABELS } from '../domain/auth/permissions.js'

export const USER_EXPORT_SHEET_NAME = '用户列表'

/** 导出表头 */
export const USER_EXPORT_HEADERS = [
  '用户名',
  '所属班组',
  '角色',
  '状态',
  '密码更新时间',
  '是否须改密',
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

/**
 * 导出用户列表为 Excel。
 * 不含密码（明文与哈希均不导出），因此导出结果不能直接当作导入模板回灌。
 *
 * @param {Array<Record<string, any>>} users
 */
export function downloadUserExport(users) {
  const rows = (users || []).map((u) => ({
    用户名: u.username || '',
    所属班组: u.team || '',
    角色: ROLE_LABELS[u.role] || u.role || '',
    状态: u.status === 'active' ? '正常' : '禁用',
    密码更新时间: u.passwordChangedAt?.slice(0, 10) || '',
    是否须改密: u.mustChangePassword ? '是' : '否',
  }))

  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows, { header: USER_EXPORT_HEADERS })
  sheet['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, sheet, USER_EXPORT_SHEET_NAME)

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  triggerDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `用户管理-导出-${new Date().toISOString().slice(0, 10)}.xlsx`,
  )
}
