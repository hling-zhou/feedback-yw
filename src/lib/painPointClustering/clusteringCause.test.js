import { describe, expect, it } from 'vitest'
import {
  causesCompatible,
  getClusteringCauseText,
  getClusteringCauseKey,
  isOrganizationalCauseText,
  pickRepresentativeCause,
  stripOrgBlamePath,
} from './clusteringCause.js'

const rec = (patch = {}) => ({
  id: '1',
  product: '弹性公网IP',
  dataSourceType: 'complaint_ticket',
  ...patch,
})

describe('isOrganizationalCauseText', () => {
  it('flags L1/L2 labels', () => {
    expect(isOrganizationalCauseText('云能问题')).toBe(true)
    expect(isOrganizationalCauseText('产品原因')).toBe(true)
    expect(isOrganizationalCauseText('客户体验类')).toBe(true)
  })

  it('flags placeholders', () => {
    expect(isOrganizationalCauseText('待分析')).toBe(true)
    expect(isOrganizationalCauseText('无法复现')).toBe(true)
    expect(isOrganizationalCauseText('/')).toBe(true)
    expect(isOrganizationalCauseText('')).toBe(true)
  })

  it('flags tree-path concatenations', () => {
    expect(isOrganizationalCauseText('云能问题 / 产品原因 / 计算部原因')).toBe(true)
    expect(isOrganizationalCauseText('云能问题/产品原因/硬件问题')).toBe(true)
  })

  it('accepts concrete mechanism', () => {
    expect(isOrganizationalCauseText('安全组未放行 22 端口')).toBe(false)
    expect(isOrganizationalCauseText('异网访问拥塞')).toBe(false)
    expect(isOrganizationalCauseText('安全策略')).toBe(false)
  })
})

describe('stripOrgBlamePath', () => {
  it('drops pure L1/L2', () => {
    expect(stripOrgBlamePath('云能问题')).toBe('')
    expect(stripOrgBlamePath('产品原因')).toBe('')
  })

  it('keeps L3 tail from tree path', () => {
    expect(stripOrgBlamePath('云能问题 / 产品原因 / 计算部原因')).toBe('计算部原因')
    expect(stripOrgBlamePath('云能问题/运维原因/硬件问题')).toBe('硬件问题')
  })

  it('keeps free-text mechanism', () => {
    expect(stripOrgBlamePath('安全组未放行 22 端口')).toBe('安全组未放行 22 端口')
  })
})

describe('getClusteringCauseText', () => {
  it('prefers rootCauseReview', () => {
    expect(
      getClusteringCauseText(
        rec({ rootCauseReview: '安全组未放行 22 端口', rootCause: '云能问题' }),
      ),
    ).toBe('安全组未放行 22 端口')
  })

  it('uses LLM rootCause after stripping path', () => {
    expect(getClusteringCauseText(rec({ rootCause: '云能问题/运维原因/硬件问题' }))).toBe(
      '硬件问题',
    )
  })

  it('falls back to complaintCauseL3Final when rootCause is org-blame', () => {
    expect(
      getClusteringCauseText(rec({ rootCause: '云能问题', complaintCauseL3Final: '安全策略' })),
    ).toBe('安全策略')
  })

  it('returns empty when all empty', () => {
    expect(getClusteringCauseText(rec())).toBe('')
  })

  it('skips 待分析 placeholder', () => {
    expect(getClusteringCauseText(rec({ rootCause: '待分析' }))).toBe('')
  })
})

describe('causesCompatible', () => {
  it('same cause merges', () => {
    expect(
      causesCompatible(
        rec({ rootCause: '安全组未放行 22 端口' }),
        rec({ rootCause: '安全组未放行 22 端口' }),
      ),
    ).toBe(true)
  })

  it('different causes forbid merge even if pain similar', () => {
    expect(
      causesCompatible(
        rec({ rootCause: '安全组未放行 22 端口' }),
        rec({ rootCause: '弹性公网 IP 未绑定到云主机' }),
      ),
    ).toBe(false)
  })

  it('both empty returns null (fallback to pain similarity)', () => {
    expect(causesCompatible(rec(), rec())).toBe(null)
  })

  it('one has cause, other empty forbids merge', () => {
    expect(causesCompatible(rec({ rootCause: '安全组未放行 22 端口' }), rec())).toBe(false)
  })
})

describe('pickRepresentativeCause', () => {
  it('picks majority cause', () => {
    const records = [
      rec({ id: '1', rootCause: '安全组未放行端口' }),
      rec({ id: '2', rootCause: '安全组未放行端口' }),
      rec({ id: '3', rootCause: '带宽超限' }),
    ]
    expect(pickRepresentativeCause(records)).toBe('安全组未放行端口')
  })

  it('returns empty when no usable cause', () => {
    expect(pickRepresentativeCause([rec({ rootCause: '云能问题' })])).toBe('')
  })
})
