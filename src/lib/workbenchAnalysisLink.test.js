import { describe, expect, it } from 'vitest'
import {
  buildWorkbenchAnalysisUrl,
  parseAnalysisSearchParams,
  patchAnalysisSearchParams,
} from './workbenchAnalysisLink.js'

describe('workbenchAnalysisLink', () => {
  it('builds analysis url with source and product', () => {
    expect(
      buildWorkbenchAnalysisUrl({
        source: 'complaint_ticket',
        product: '弹性云服务器',
      }),
    ).toBe('/workbench/analysis?source=complaint_ticket&product=%E5%BC%B9%E6%80%A7%E4%BA%91%E6%9C%8D%E5%8A%A1%E5%99%A8')
  })

  it('builds url with journey, problem, scene and tab', () => {
    const url = buildWorkbenchAnalysisUrl({
      product: 'ECS',
      journeyL1: '开通',
      journeyL2: '绑定',
      problemType: '性能类',
      requestScene: '报障',
      tab: 'journey',
    })
    expect(url).toContain('product=ECS')
    expect(url).toContain('journeyL1')
    expect(url).toContain('problemType')
    expect(url).toContain('tab=journey')
  })

  it('ignores overview source and invalid tab', () => {
    expect(buildWorkbenchAnalysisUrl({ source: 'overview', product: 'ECS' })).toBe(
      '/workbench/analysis?product=ECS',
    )
    expect(buildWorkbenchAnalysisUrl({ tab: 'invalid', product: 'ECS' })).toBe(
      '/workbench/analysis?product=ECS',
    )
  })

  it('parses and patches search params', () => {
    const sp = new URLSearchParams(
      'source=complaint_ticket&product=ECS&journeyL1=A&journeyL2=B&problemType=性能&requestScene=报障&tab=problem',
    )
    expect(parseAnalysisSearchParams(sp)).toEqual({
      source: 'complaint_ticket',
      product: 'ECS',
      journeyL1: 'A',
      journeyL2: 'B',
      problemType: '性能',
      requestScene: '报障',
      tab: 'problem',
    })
    const next = patchAnalysisSearchParams(sp, { product: 'SLB', source: '' })
    expect(next.get('product')).toBe('SLB')
    expect(next.get('source')).toBeNull()
  })
})
