import { describe, expect, it } from 'vitest'
import {
  filterRecordsForTopicRecommend,
  keepRecordForTopicRecommend,
  postUseHasNegativeFeedback,
} from './recommendScope.js'

function postUse(overrides = {}) {
  return {
    id: 'p1',
    dataSourceType: 'post_use_rating',
    product: '弹性公网IP',
    productName: '弹性公网IP',
    ratingScore: 10,
    channel: 'console',
    ...overrides,
  }
}

describe('topic recommend post-use scope', () => {
  it('drops 10-score post-use with no text or only praise', () => {
    expect(keepRecordForTopicRecommend(postUse())).toBe(false)
    expect(keepRecordForTopicRecommend(postUse({ commentText: '用着很稳定' }))).toBe(false)
    expect(keepRecordForTopicRecommend(postUse({
      feedbackReasonTexts: ['无/不涉及'],
      commentText: '',
    }))).toBe(false)
    expect(postUseHasNegativeFeedback(postUse({ commentText: '用着很稳定' }))).toBe(false)
  })

  it('keeps 10-score post-use with a taxonomy reason or negative free text', () => {
    expect(keepRecordForTopicRecommend(postUse({
      feedbackReasonTexts: ['功能有缺失'],
    }))).toBe(true)
    expect(keepRecordForTopicRecommend(postUse({
      channel: 'sms',
      commentText: '给了满分但还是太卡了',
    }))).toBe(true)
  })

  it('keeps non-10 post-use and all tickets', () => {
    expect(keepRecordForTopicRecommend(postUse({ ratingScore: 8, commentText: '' }))).toBe(true)
    expect(keepRecordForTopicRecommend({
      id: 't1',
      dataSourceType: 'complaint_ticket',
      product: '弹性公网IP',
    })).toBe(true)
    const filtered = filterRecordsForTopicRecommend([
      postUse({ id: 'drop' }),
      postUse({ id: 'keep-reason', feedbackReasonTexts: ['功能有缺失'] }),
      { id: 'ticket', dataSourceType: 'consultation_ticket', product: '弹性公网IP' },
    ])
    expect(filtered.map((row) => row.id)).toEqual(['keep-reason', 'ticket'])
  })
})
