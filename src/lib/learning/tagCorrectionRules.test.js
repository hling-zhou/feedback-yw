import { describe, expect, it, beforeEach } from 'vitest'
import {
  applyCorrectionOverlay,
  setCorrectionRulesCache,
} from './tagCorrectionRules.js'
import { preserveManualTags } from '../manualTagFields.js'

describe('applyCorrectionOverlay', () => {
  beforeEach(() => setCorrectionRulesCache([]))

  it('overrides scene/type when approved keywords hit', () => {
    setCorrectionRulesCache([
      {
        id: 'rule-1',
        dimension: 'requestScene',
        fromLabel: '资源操作申请',
        toLabel: '产品信息咨询',
        keywords: ['提升配额', '配额超限'],
        evidenceCount: 3,
        status: 'approved',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const out = applyCorrectionOverlay(
      {
        requestScene: '资源操作申请',
        problemType: '资源开通与创建',
        journeyL1: '开通与创建',
        journeyL2: '带宽选择',
      },
      'EIP 配额超限，申请提升配额',
    )
    expect(out.requestScene).toBe('产品信息咨询')
    expect(out.overlayHits).toContain('requestScene')
  })

  it('does not apply pending or rejected rules', () => {
    setCorrectionRulesCache([
      {
        id: 'rule-2',
        dimension: 'problemType',
        fromLabel: '其他',
        toLabel: '配额与权限申请',
        keywords: ['配额'],
        evidenceCount: 3,
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const out = applyCorrectionOverlay(
      { requestScene: '产品信息咨询', problemType: '其他', journeyL1: '', journeyL2: '' },
      '配额不够',
    )
    expect(out.problemType).toBe('其他')
    expect(out.overlayHits).toEqual([])
  })
})

describe('preserveManualTags vs learning overlay', () => {
  it('keeps human tags and lastAutoTags from processed', () => {
    const original = {
      requestScene: '产品信息咨询',
      problemType: '配额与权限申请',
      journeyL1: '配额与权限',
      journeyL2: '配额申请',
      manualTagFields: ['requestScene', 'problemType', 'journey'],
      lastAutoTags: { requestScene: '资源操作申请', problemType: '其他', journeyL1: 'a', journeyL2: 'b' },
    }
    const processed = {
      requestScene: '报障与排错',
      problemType: '可用性/连通性故障',
      journeyL1: '故障',
      journeyL2: '排查',
      lastAutoTags: { requestScene: '报障与排错', problemType: '可用性/连通性故障', journeyL1: '故障', journeyL2: '排查' },
    }
    const kept = preserveManualTags(original, processed)
    expect(kept.requestScene).toBe('产品信息咨询')
    expect(kept.lastAutoTags.requestScene).toBe('报障与排错')
  })
})
