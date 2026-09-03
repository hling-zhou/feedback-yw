import { describe, expect, it } from 'vitest'
import { getVisibleSettingsTabs, resolveSettingsTab } from './settingsTabs.js'

describe('settingsTabs', () => {
  it('getVisibleSettingsTabs respects role capabilities', () => {
    const admin = getVisibleSettingsTabs((p) =>
      [
        'manageLlmConfig',
        'manageTeamSettings',
        'editOrderVolumes',
        'deleteData',
        'export',
        'viewAudit',
        'view',
        'manageRequirementSync',
      ].includes(p),
    )
    expect(admin).toEqual(['llm', 'analysis', 'metrics', 'data', 'audit', 'bottles', 'requirement_sync'])

    const editor = getVisibleSettingsTabs((p) =>
      ['editOrderVolumes', 'deleteData', 'export', 'viewAudit', 'view'].includes(p),
    )
    // editor 不再有大模型 Tab（manageLlmConfig 仅 admin）
    expect(editor).toEqual(['metrics', 'data', 'audit', 'bottles'])

    const viewer = getVisibleSettingsTabs((p) => ['export', 'viewAudit', 'view'].includes(p))
    expect(viewer).toEqual(['data', 'audit', 'bottles'])
  })

  it('resolveSettingsTab falls back to first visible tab', () => {
    expect(resolveSettingsTab('metrics', ['llm', 'metrics'])).toBe('metrics')
    expect(resolveSettingsTab('audit', ['llm', 'metrics'])).toBe('llm')
    expect(resolveSettingsTab('', [])).toBe(null)
  })
})
