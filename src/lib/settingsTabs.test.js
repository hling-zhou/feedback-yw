import { describe, expect, it } from 'vitest'
import { getVisibleSettingsTabs, resolveSettingsTab } from './settingsTabs.js'

describe('settingsTabs', () => {
  it('getVisibleSettingsTabs respects role capabilities', () => {
    const admin = getVisibleSettingsTabs((p) =>
      [
        'configureLlmPersonal',
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
      ['configureLlmPersonal', 'editOrderVolumes', 'deleteData', 'export', 'viewAudit', 'view'].includes(
        p,
      ),
    )
    expect(editor).toEqual(['llm', 'metrics', 'data', 'audit', 'bottles'])

    const viewer = getVisibleSettingsTabs((p) =>
      ['configureLlmPersonal', 'export', 'viewAudit', 'view'].includes(p),
    )
    expect(viewer).toEqual(['llm', 'data', 'audit', 'bottles'])
  })

  it('resolveSettingsTab falls back to first visible tab', () => {
    expect(resolveSettingsTab('metrics', ['llm', 'metrics'])).toBe('metrics')
    expect(resolveSettingsTab('audit', ['llm', 'metrics'])).toBe('llm')
    expect(resolveSettingsTab('', [])).toBe(null)
  })
})
