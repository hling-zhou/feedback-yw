import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('FollowUpSatisfactionPanel channel fallback', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'FollowUpSatisfactionPanel.jsx'), 'utf8')

  it('shows imported callback metrics when no ticket enrichment exists', () => {
    expect(source).toContain('channelMetrics?.totalSample > 0')
    expect(source).toContain('回访满意度（渠道口径）')
    expect(source).toContain('暂无样本关联到投诉/咨询工单')
    expect(source).toContain('dataSource={channelMetrics.byProduct}')
  })

  it('does not claim imported callback data is absent', () => {
    expect(source).not.toContain('上传满意度回访记录并完成工单补全')
    expect(source).toContain('当前周期内暂无投诉回访评分样本')
  })
})
