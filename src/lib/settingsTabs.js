/** @typedef {'llm' | 'analysis' | 'metrics' | 'data' | 'audit'} SettingsTabKey */

export const SETTINGS_TAB_KEYS = /** @type {const} */ ([
  'llm',
  'analysis',
  'metrics',
  'data',
  'audit',
])

/** @type {Record<SettingsTabKey, string>} */
export const SETTINGS_TAB_LABELS = {
  llm: '大模型',
  analysis: '分析与打标',
  metrics: '万投比指标',
  data: '数据管理',
  audit: '审计日志',
}

/** @type {Record<SettingsTabKey, string>} */
export const SETTINGS_TAB_DESCRIPTIONS = {
  llm: '本机大模型连接，用于导入、打标与洞察中的 LLM 能力；仅保存在当前浏览器。',
  analysis: '团队共享的自动打标与分析规则，保存后约 5 秒内同步给其他用户。',
  metrics: '维护万投比分母与达标目标，供工作台投诉 Tab 展示与对比。',
  data: '导出备份、恢复数据或按范围清空已导入工单与洞察快照。',
  audit: '查看导入、清空、配置发布等关键操作记录。',
}

const SETTINGS_TAB_KEY_SET = new Set(SETTINGS_TAB_KEYS)

/**
 * @param {(permission: import('../domain/auth/permissions.js').PermissionCode) => boolean} can
 * @returns {SettingsTabKey[]}
 */
export function getVisibleSettingsTabs(can) {
  /** @type {SettingsTabKey[]} */
  const tabs = []
  if (can('configureLlmPersonal')) tabs.push('llm')
  if (can('manageTeamSettings')) tabs.push('analysis')
  if (can('editOrderVolumes')) tabs.push('metrics')
  if (can('manageTeamSettings') || can('deleteData') || can('export')) tabs.push('data')
  if (can('viewAudit')) tabs.push('audit')
  return tabs
}

/**
 * @param {string | null | undefined} raw
 * @param {SettingsTabKey[]} visibleTabs
 * @returns {SettingsTabKey | null}
 */
export function resolveSettingsTab(raw, visibleTabs) {
  const key = String(raw ?? '').trim()
  if (SETTINGS_TAB_KEY_SET.has(key) && visibleTabs.includes(key)) {
    return /** @type {SettingsTabKey} */ (key)
  }
  return visibleTabs[0] ?? null
}
