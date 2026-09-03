import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./apiClient.js', () => ({
  apiFetch: vi.fn(),
}))

import {
  detectSecondaryProductKeys,
  buildKnowledgeQuery,
  retrieveKnowledgeSnippets,
  formatKnowledgeSnippetsForPrompt,
} from './knowledgeBaseClient.js'
import { apiFetch } from './apiClient.js'

const CATALOG = [
  { key: 'eip', name: '弹性公网IP', match: ['EIP', '弹性公网 IP'], specs: [] },
  { key: 'vpc', name: '虚拟私有云', match: ['VPC'], specs: [] },
  { key: 'elb', name: '负载均衡', specs: [] },
]

describe('knowledgeBaseClient', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
  })

  it('detectSecondaryProductKeys finds other products and excludes primary', () => {
    const text = '客户使用弹性公网IP，同时涉及VPC安全组配置不当'
    const secondary = detectSecondaryProductKeys(text, CATALOG, 'eip')
    expect(secondary).toContain('vpc')
    expect(secondary).not.toContain('eip')
  })

  it('detectSecondaryProductKeys returns empty when only primary mentioned', () => {
    const secondary = detectSecondaryProductKeys('弹性公网IP带宽超限', CATALOG, 'eip')
    expect(secondary).toEqual([])
  })

  it('detectSecondaryProductKeys returns empty for empty text', () => {
    expect(detectSecondaryProductKeys('', CATALOG, 'eip')).toEqual([])
  })

  it('buildKnowledgeQuery assembles productKeys/text/tags', () => {
    const record = {
      productKey: 'eip',
      painPoint: '带宽超限',
      customerRequest: '希望提升带宽',
      rawText: '原始工单内容',
      journeyL1: '使用',
      journeyL2: '带宽管理',
      problemType: '性能',
      requestScene: '业务使用',
      productSpec: '独享带宽',
    }
    const query = buildKnowledgeQuery(record, CATALOG)
    expect(query.productKeys).toEqual(['eip'])
    expect(query.text).toContain('带宽超限')
    expect(query.text).toContain('希望提升带宽')
    expect(query.tags).toEqual(['使用', '带宽管理', '性能', '业务使用', '独享带宽'])
  })

  it('buildKnowledgeQuery appends secondary productKeys', () => {
    const record = {
      productKey: 'eip',
      painPoint: 'VPC安全组配置不当导致访问失败',
      customerRequest: '',
      journeyL1: '使用',
    }
    const query = buildKnowledgeQuery(record, CATALOG)
    expect(query.productKeys).toEqual(['eip', 'vpc'])
  })

  it('retrieveKnowledgeSnippets returns results on success', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      results: [[{ title: '独享带宽', content: '订购流程', productKey: 'eip' }]],
    })
    const results = await retrieveKnowledgeSnippets([
      { productKeys: ['eip'], text: '带宽', tags: [] },
    ])
    expect(results).toHaveLength(1)
    expect(results[0][0].title).toBe('独享带宽')
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/knowledge-base/retrieve',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('retrieveKnowledgeSnippets degrades to empty on failure', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('network'))
    const results = await retrieveKnowledgeSnippets([
      { productKeys: ['eip'], text: 'x', tags: [] },
      { productKeys: ['vpc'], text: 'y', tags: [] },
    ])
    expect(results).toEqual([[], []])
  })

  it('retrieveKnowledgeSnippets returns empty for no queries', async () => {
    expect(await retrieveKnowledgeSnippets([])).toEqual([])
  })

  it('formatKnowledgeSnippetsForPrompt formats with productKey and title', () => {
    const out = formatKnowledgeSnippetsForPrompt([
      { title: '独享带宽', content: '订购流程', productKey: 'eip' },
    ])
    expect(out).toContain('【eip】')
    expect(out).toContain('独享带宽')
    expect(out).toContain('订购流程')
  })

  it('formatKnowledgeSnippetsForPrompt returns empty string for no snippets', () => {
    expect(formatKnowledgeSnippetsForPrompt([])).toBe('')
    expect(formatKnowledgeSnippetsForPrompt(undefined)).toBe('')
  })
})
