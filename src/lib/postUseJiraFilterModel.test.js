import { describe, expect, it } from 'vitest'
import {
  countActivePostUseJiraFilters,
  createEmptyPostUseJiraFilters,
  formatPostUseJiraFilterChipLabel,
  listActivePostUseJiraFilterChipKeys,
  postUseJiraFiltersToListQuery,
} from './postUseJiraFilterModel.js'
import {
  buildPostUseJiraFilterPatchFromDraft,
  isPostUseJiraFilterDraftValid,
} from './postUseJiraFilterEditors.js'

describe('postUseJiraFilterModel', () => {
  it('lists chips and maps to the list query', () => {
    const values = {
      ...createEmptyPostUseJiraFilters(),
      importMonth: '2026-08',
      productName: '弹性公网IP',
      status: '进行中',
      search: '铁塔',
    }
    expect(listActivePostUseJiraFilterChipKeys(values)).toEqual([
      'importMonth',
      'productName',
      'status',
      'search',
    ])
    expect(countActivePostUseJiraFilters(values)).toBe(4)
    expect(formatPostUseJiraFilterChipLabel('status', values)).toBe('进行中')
    expect(formatPostUseJiraFilterChipLabel('search', values)).toBe('铁塔')
    expect(postUseJiraFiltersToListQuery(values)).toEqual({
      importMonth: '2026-08',
      productName: '弹性公网IP',
      status: '进行中',
      search: '铁塔',
    })
  })

  it('treats blank drafts as invalid', () => {
    expect(isPostUseJiraFilterDraftValid('search', '  ')).toBe(false)
    expect(buildPostUseJiraFilterPatchFromDraft('importMonth', ' 2026-08 ')).toEqual({
      importMonth: '2026-08',
    })
  })
})
