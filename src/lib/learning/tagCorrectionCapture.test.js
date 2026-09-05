import { describe, expect, it } from 'vitest'
import { buildCorrectionEventsFromEdit } from './tagCorrectionCapture.js'

describe('buildCorrectionEventsFromEdit', () => {
  it('captures scene/type/journey when user changes tags vs lastAutoTags', () => {
    const existing = {
      id: 'r1',
      productKey: 'eip',
      requestScene: '资源操作申请',
      problemType: '资源开通与创建',
      journeyL1: '开通与创建',
      journeyL2: '带宽选择',
      customerRequest: 'EIP 配额超限，申请提升配额',
      painPoint: '配额不够无法购买',
      lastAutoTags: {
        requestScene: '资源操作申请',
        problemType: '资源开通与创建',
        journeyL1: '开通与创建',
        journeyL2: '带宽选择',
      },
    }
    const events = buildCorrectionEventsFromEdit(existing, {
      requestScene: '产品信息咨询',
      problemType: '配额与权限申请',
      journeyL1: '配额与权限',
      journeyL2: '配额申请',
    })
    expect(events.map((e) => e.dimension).sort()).toEqual(['journey', 'problemType', 'requestScene'])
    expect(events.find((e) => e.dimension === 'requestScene')).toMatchObject({
      systemLabel: '资源操作申请',
      userLabel: '产品信息咨询',
    })
    expect(events.find((e) => e.dimension === 'journey')?.userLabel).toBe('配额与权限 > 配额申请')
  })

  it('skips when user label matches system snapshot', () => {
    const existing = {
      id: 'r2',
      requestScene: '报障与排错',
      lastAutoTags: { requestScene: '报障与排错', problemType: '', journeyL1: '', journeyL2: '' },
    }
    expect(buildCorrectionEventsFromEdit(existing, { requestScene: '报障与排错' })).toEqual([])
  })
})
