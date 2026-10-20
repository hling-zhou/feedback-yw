import { describe, expect, it } from 'vitest'
import { getVisibleSettingsTabs, resolveSettingsTab } from './settingsTabs.js'

describe('settingsTabs', () => {
  it('getVisibleSettingsTabs respects role capabilities', () => {
    const admin = getVisibleSettingsTabs((p) =>
      [
        'manageLlmConfig',
        'manageTeamSettings',
        'manageTags',
        'editOrderVolumes',
        'deleteData',
        'export',
        'viewAudit',
        'view',
        'manageRequirementSync',
      ].includes(p),
    )
    expect(admin).toEqual([
      'llm', 'analysis', 'metrics', 'data', 'audit', 'bottles',
      'requirement_sync', 'pipeline', 'curated_taxonomy', 'mail',
    ])

    const editor = getVisibleSettingsTabs((p) =>
      ['editOrderVolumes', 'deleteData', 'export', 'viewAudit', 'view', 'manageTags'].includes(p),
    )
    // editor 有 manageTags，可编辑邮件发送（mail）；无 manageTeamSettings
    expect(editor).toEqual([
      'llm', 'analysis', 'metrics', 'data', 'audit', 'bottles',
      'requirement_sync', 'pipeline', 'curated_taxonomy', 'mail',
    ])

    const viewer = getVisibleSettingsTabs((p) => ['export', 'viewAudit', 'view'].includes(p))
    // viewer 同样能看到只读 Tab
    expect(viewer).toEqual([
      'llm', 'analysis', 'data', 'audit', 'bottles',
      'requirement_sync', 'pipeline', 'curated_taxonomy',
    ])
  })

  it('resolveSettingsTab falls back to first visible tab', () => {
    expect(resolveSettingsTab('metrics', ['llm', 'metrics'])).toBe('metrics')
    expect(resolveSettingsTab('audit', ['llm', 'metrics'])).toBe('llm')
    expect(resolveSettingsTab('', [])).toBe(null)
  })
})
