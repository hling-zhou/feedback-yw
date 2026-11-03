import { describe, expect, it } from 'vitest'

import {
  GENERALIZATION_CATEGORY_LABELS,
  GENERALIZATION_CATEGORIES,
  GENERALIZATION_ISSUE_STATUS_LABELS,
  GENERALIZATION_ISSUE_STATUSES,
  GENERALIZATION_LINK_DEDUPE_HINT,
  GENERALIZATION_SCOPE_LABELS,
  GENERALIZATION_SCOPES,
  GENERALIZATION_SUMMARY_MAX_LENGTH,
  buildGeneralizationIssueFromInput,
  buildGeneralizationLinkFromInput,
  formatGeneralizationCategoryLabel,
  isGeneralizationCategory,
  isGeneralizationIssueStatus,
  isGeneralizationLinkStatus,
  isGeneralizationRecordDataSource,
  isGeneralizationScope,
  normalizeGeneralizationPayload,
} from './generalizationIssue.js'

const VALID_INPUT = {
  productKey: 'eip',
  productName: '弹性公网IP',
  title: '退订入口难找',
  summary: '控制台找不到退订入口，列表超 50 条翻不到',
  category: 'console_ux',
  scope: 'multi_scenario',
}

describe('generalizationIssue 枚举', () => {
  it('状态机三态与设计 §2.1 一致（进行中/已完成/未完成终止）', () => {
    expect(GENERALIZATION_ISSUE_STATUSES).toEqual(['in_progress', 'completed', 'terminated'])
    expect(GENERALIZATION_ISSUE_STATUS_LABELS).toEqual({
      in_progress: '进行中',
      completed: '已完成',
      terminated: '未完成终止',
    })
  })

  it('category 六选一与设计 §2.3 一致', () => {
    expect(GENERALIZATION_CATEGORIES).toHaveLength(6)
    expect(GENERALIZATION_CATEGORY_LABELS.api_doc).toBe('API 文档错误')
    expect(GENERALIZATION_CATEGORY_LABELS.other_intervenable).toBe('其他可介入原因')
  })

  it('scope 两值与判据 A 一致', () => {
    expect(GENERALIZATION_SCOPES).toEqual(['multi_scenario', 'cross_product'])
    expect(GENERALIZATION_SCOPE_LABELS.cross_product).toBe('跨产品共性')
  })

  it('类型守卫', () => {
    expect(isGeneralizationIssueStatus('in_progress')).toBe(true)
    expect(isGeneralizationIssueStatus('watching')).toBe(false) // 留观枚举不互通
    expect(isGeneralizationCategory('code_logic')).toBe(true)
    expect(isGeneralizationCategory('made_up')).toBe(false)
    expect(isGeneralizationScope('cross_product')).toBe(true)
    expect(isGeneralizationScope('')).toBe(false)
    expect(isGeneralizationLinkStatus('pending_suggest')).toBe(true)
    expect(isGeneralizationRecordDataSource('complaint_ticket')).toBe(true)
    expect(isGeneralizationRecordDataSource('post_use_rating')).toBe(true)
  })
})

describe('buildGeneralizationIssueFromInput', () => {
  it('合法输入构建成功（默认 in_progress、root_cause/optimization 可空）', () => {
    const { issue, errors } = buildGeneralizationIssueFromInput(VALID_INPUT)
    expect(errors).toEqual([])
    expect(issue.id).toBeTruthy()
    expect(issue.status).toBe('in_progress')
    expect(issue.category).toBe('console_ux')
    expect(issue.scope).toBe('multi_scenario')
    expect(issue.rootCause).toBe('') // 创建允许空（v3.4）
    expect(issue.optimization).toBe('')
    expect(issue.originActionId).toBe('')
    expect(issue.createdAt).toBeTruthy()
  })

  it('category 缺失报错（定义性必填）', () => {
    const { errors } = buildGeneralizationIssueFromInput({ ...VALID_INPUT, category: '' })
    expect(errors).toContain('可介入原因范畴必填（六选一）')
  })

  it('scope 缺失报错', () => {
    const { errors } = buildGeneralizationIssueFromInput({ ...VALID_INPUT, scope: '' })
    expect(errors).toContain('共性范围必填（多场景共性 / 跨产品共性）')
  })

  it('标题/描述空值与超长校验（对齐留观 100 字口径）', () => {
    const { errors } = buildGeneralizationIssueFromInput({
      ...VALID_INPUT,
      title: '',
      summary: '长'.repeat(GENERALIZATION_SUMMARY_MAX_LENGTH + 1),
    })
    expect(errors).toContain('问题标题不能为空')
    expect(errors).toContain(`问题描述不能超过 ${GENERALIZATION_SUMMARY_MAX_LENGTH} 字`)
  })

  it('产品缺失报错', () => {
    const { errors } = buildGeneralizationIssueFromInput({ ...VALID_INPUT, productName: '' })
    expect(errors).toContain('产品不能为空')
  })

  it('root_cause/optimization 创建时空值合法、超长拦截（2000 字）', () => {
    const ok = buildGeneralizationIssueFromInput({
      ...VALID_INPUT,
      rootCause: '',
      optimization: '',
    })
    expect(ok.errors).toEqual([])

    const long = buildGeneralizationIssueFromInput({
      ...VALID_INPUT,
      rootCause: '长'.repeat(2001),
      optimization: '长'.repeat(2001),
    })
    expect(long.errors).toContain('根因分析不能超过 2000 字')
    expect(long.errors).toContain('优化方案不能超过 2000 字')
  })

  it('originActionId 透传（升级通路首创建举措）', () => {
    const { issue } = buildGeneralizationIssueFromInput({
      ...VALID_INPUT,
      originActionId: 'act_123',
    })
    expect(issue.originActionId).toBe('act_123')
  })

  it('keywords 归一去空去重（≤20）', () => {
    const { issue } = buildGeneralizationIssueFromInput({
      ...VALID_INPUT,
      keywords: [' 退订 ', '', '退订', '入口', ...Array.from({ length: 25 }, (_, i) => `k${i}`)],
    })
    expect(issue.payload.keywords?.[0]).toBe('退订')
    expect(issue.payload.keywords?.filter((k) => k === '退订')).toHaveLength(1)
    expect(issue.payload.keywords).toHaveLength(20)
  })
})

describe('buildGeneralizationLinkFromInput', () => {
  it('合法 confirmed 人工 link', () => {
    const { link, errors } = buildGeneralizationLinkFromInput({
      issueId: 'gi1',
      recordId: 'r1',
      ticketId: 'T100',
    })
    expect(errors).toEqual([])
    expect(link.linkStatus).toBe('confirmed')
    expect(link.linkSource).toBe('manual')
    expect(link.recordDataSource).toBe('')
  })

  it('pending_suggest 必须携带 recordDataSource（自动建议守卫）', () => {
    const { errors } = buildGeneralizationLinkFromInput({
      issueId: 'gi1',
      recordId: 'r1',
      linkStatus: 'pending_suggest',
    })
    expect(errors).toContain('自动建议必须携带记录数据来源（recordDataSource）')
  })

  it('issueId/recordId 缺失报错', () => {
    const { errors } = buildGeneralizationLinkFromInput({ issueId: '', recordId: '' })
    expect(errors).toContain('issueId 不能为空')
    expect(errors).toContain('recordId 不能为空')
  })

  it('dedupe hint 常量存在（UNIQUE 镜像提示）', () => {
    expect(GENERALIZATION_LINK_DEDUPE_HINT).toContain('举一反三')
  })
})

describe('normalizeGeneralizationPayload', () => {
  it('非对象输入返回空对象', () => {
    expect(normalizeGeneralizationPayload(null)).toEqual({})
    expect(normalizeGeneralizationPayload('str')).toEqual({})
  })

  it('notes 去空格透传、空串丢弃', () => {
    expect(normalizeGeneralizationPayload({ notes: '  备注内容 ' })).toEqual({ notes: '备注内容' })
    expect(normalizeGeneralizationPayload({ notes: '   ' })).toEqual({})
  })

  it('categoryOther 透传并截断 100 字（11-04「其他」自定义说明）', () => {
    expect(normalizeGeneralizationPayload({ categoryOther: ' 服务端配置默认值不合理 ' })).toEqual({
      categoryOther: '服务端配置默认值不合理',
    })
    expect(normalizeGeneralizationPayload({ categoryOther: 'x'.repeat(150) }).categoryOther).toHaveLength(100)
    expect(normalizeGeneralizationPayload({ categoryOther: '' })).toEqual({})
  })
})

describe('formatGeneralizationCategoryLabel（11-04「其他」拼接展示）', () => {
  it('普通范畴返回标准 label', () => {
    expect(formatGeneralizationCategoryLabel('code_logic')).toBe('编码逻辑不当')
    expect(formatGeneralizationCategoryLabel('api_doc', '忽略非 other 的说明')).toBe('API 文档错误')
  })

  it('other + 自定义说明拼「其他：xxx」', () => {
    expect(formatGeneralizationCategoryLabel('other_intervenable', '服务端配置默认值不合理')).toBe(
      '其他：服务端配置默认值不合理',
    )
  })

  it('other 无说明返回标准 label；空枚举返回空串', () => {
    expect(formatGeneralizationCategoryLabel('other_intervenable')).toBe('其他可介入原因')
    expect(formatGeneralizationCategoryLabel('')).toBe('')
  })
})
