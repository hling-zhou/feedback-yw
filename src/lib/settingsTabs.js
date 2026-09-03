/** @typedef {'llm' | 'analysis' | 'metrics' | 'data' | 'audit' | 'bottles' | 'requirement_sync' | 'knowledge_base'} SettingsTabKey */

export const SETTINGS_TAB_KEYS = /** @type {const} */ ([
  'llm',
  'analysis',
  'metrics',
  'data',
  'audit',
  'bottles',
  'requirement_sync',
  'knowledge_base',
])

/** @type {Record<SettingsTabKey, string>} */
export const SETTINGS_TAB_LABELS = {
  llm: '大模型',
  analysis: '分析与打标',
  metrics: '万投比指标',
  data: '数据管理',
  audit: '审计日志',
  bottles: '漂流瓶',
  requirement_sync: '需求工单进展同步',
  knowledge_base: '产品知识库',
}

/** @type {Record<SettingsTabKey, string>} */
export const SETTINGS_TAB_DESCRIPTIONS = {
  llm: '团队大模型配置，用于导入、打标与洞察中的 LLM 能力；仅管理员可改，保存后全团队生效（库优先于环境变量）。',
  analysis:
    '团队共享的自动打标与分析规则；修改后底部会出现保存条，保存后约 5 秒内同步给其他用户。',
  metrics:
    '按产品维护万投比目标与月订单数；修改后底部会出现保存条，每个产品独立保存。',
  data: '导出备份、恢复数据或按范围清空已导入工单与洞察快照。',
  audit: '查看导入、清空、配置发布等关键操作记录。',
  bottles: '查看用户通过漂流瓶提交的优化建议、新点子；管理员可更新处理进展。',
  requirement_sync:
    '维护外部需求工单进展与状态映射，管理外部系统 API Key；举措关联需求工单后，排期与状态由此同步展示。',
  knowledge_base:
    '上传/管理各产品的业务知识库，供工单自动分析的「优化建议」检索引用；同一产品上传即覆盖。',
}

const SETTINGS_TAB_KEY_SET = new Set(SETTINGS_TAB_KEYS)

/**
 * @param {(permission: import('../domain/auth/permissions.js').PermissionCode) => boolean} can
 * @returns {SettingsTabKey[]}
 */
export function getVisibleSettingsTabs(can) {
  /** @type {SettingsTabKey[]} */
  const tabs = []
  if (can('manageLlmConfig')) tabs.push('llm')
  if (can('manageTeamSettings')) tabs.push('analysis')
  if (can('editOrderVolumes')) tabs.push('metrics')
  if (can('manageTeamSettings') || can('deleteData') || can('export')) tabs.push('data')
  if (can('viewAudit')) tabs.push('audit')
  if (can('view')) tabs.push('bottles')
  if (can('manageRequirementSync')) tabs.push('requirement_sync')
  if (can('manageKnowledgeBase')) tabs.push('knowledge_base')
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
