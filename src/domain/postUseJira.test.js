import { describe, expect, it } from 'vitest'
import { pickPostUseJiraEditablePatch, POST_USE_JIRA_DEFAULT_STATUS } from './postUseJira.js'

describe('postUseJira editable patch', () => {
  it('only keeps JIRA ticket, status and progress', () => {
    const patch = pickPostUseJiraEditablePatch({
      jiraTicket: ' JIRA-1 ',
      status: '进行中',
      progress: '已提单',
      customerName: '不应修改',
      customerFeedback: '不应修改',
      productName: '不应修改',
    })
    expect(patch).toEqual({
      jiraTicket: 'JIRA-1',
      status: '进行中',
      progress: '已提单',
    })
  })

  it('falls back to 待处理 for unknown status', () => {
    expect(pickPostUseJiraEditablePatch({ status: 'unknown' }).status).toBe(POST_USE_JIRA_DEFAULT_STATUS)
  })
})
