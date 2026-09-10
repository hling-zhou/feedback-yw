import { describe, it, expect } from 'vitest'
import {
  classifyHandlingQuality,
  isHandlingVerifiable,
  extractHandlingConclusionSignals,
  extractStructuralCandidates,
  crossVerifySignals,
  extractVerifiedSupplementSignals,
} from './handlingSignalExtract.js'

describe('classifyHandlingQuality', () => {
  it('returns empty for null/undefined/\\N', () => {
    expect(classifyHandlingQuality(null)).toBe('empty')
    expect(classifyHandlingQuality(undefined)).toBe('empty')
    expect(classifyHandlingQuality('')).toBe('empty')
    expect(classifyHandlingQuality('\\N')).toBe('empty')
    expect(classifyHandlingQuality('NA')).toBe('empty')
  })

  it('returns root_cause for handling with 经排查/定位为', () => {
    expect(classifyHandlingQuality('经排查，客户子网与路由表网段存在冲突')).toBe('root_cause')
    expect(classifyHandlingQuality('定位为：安全组规则未放通')).toBe('root_cause')
  })

  it('returns action for handling with 已通知/已协助/请客户', () => {
    expect(classifyHandlingQuality('已通知客户配额已释放')).toBe('action')
    expect(classifyHandlingQuality('已协助客户完成带宽提升')).toBe('action')
    expect(classifyHandlingQuality('请客户使用其他网段创建子网')).toBe('action')
  })

  it('returns template for pure template replies', () => {
    expect(classifyHandlingQuality('敏感信息，请您在工单的机密信息框填写')).toBe('template')
    expect(classifyHandlingQuality('如有问题请随时咨询')).toBe('template')
  })

  it('returns other for unstructured content', () => {
    expect(classifyHandlingQuality('开始&客服组.南基客服专席组-01L0&处理意见：客户标签：请求节点：全局流转')).toBe('other')
  })
})

describe('isHandlingVerifiable', () => {
  it('true for root_cause and action', () => {
    expect(isHandlingVerifiable('root_cause')).toBe(true)
    expect(isHandlingVerifiable('action')).toBe(true)
  })

  it('false for other tiers', () => {
    expect(isHandlingVerifiable('voice')).toBe(false)
    expect(isHandlingVerifiable('template')).toBe(false)
    expect(isHandlingVerifiable('empty')).toBe(false)
    expect(isHandlingVerifiable('other')).toBe(false)
  })
})

describe('extractHandlingConclusionSignals', () => {
  it('extracts keywords from root cause sentences', () => {
    const signals = extractHandlingConclusionSignals('经排查，客户子网与路由表网段存在冲突，导致无法创建子网')
    expect(signals).toContain('子网')
    expect(signals).toContain('创建')
  })

  it('extracts keywords from action sentences', () => {
    const signals = extractHandlingConclusionSignals('已通知客户配额已释放，建议客户重新申请')
    expect(signals).toContain('配额')
  })

  it('returns empty for template-only handling', () => {
    expect(extractHandlingConclusionSignals('敏感信息，请您在工单的机密信息框填写')).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(extractHandlingConclusionSignals('')).toEqual([])
    expect(extractHandlingConclusionSignals(null)).toEqual([])
  })
})

describe('extractStructuralCandidates', () => {
  it('parses 请求节点 and 工单标题', () => {
    const result = extractStructuralCandidates(
      '请求节点：VPC--VPC业务变更\n工单标题：VPC业务变更\n详细内容：子网冲突',
      '',
    )
    expect(result.nodeSegments).toContain('VPC')
    expect(result.nodeSegments).toContain('VPC业务变更')
    expect(result.titleValue).toBe('VPC业务变更')
    // 子网 is in 详细内容 body, not in structural signals (title/node)
    expect(result.candidateKeywords).toContain('变更')
    expect(result.candidateKeywords).not.toContain('子网')
  })

  it('filters out 全局流转 default value', () => {
    const result = extractStructuralCandidates(
      '请求节点：全局流转--业务规则咨询/查询-全局流转\n工单标题：业务规则咨询/查询-全局流转\n详细内容：带宽不够',
      '',
    )
    expect(result.nodeSegments).toEqual([])
    expect(result.titleValue).toBe('')
  })

  it('truncates 工单标题 value at 详细内容', () => {
    const result = extractStructuralCandidates(
      '请求节点：云主机--云主机业务变更\n工单标题：云主机业务变更详细内容：云服务器带宽只跑到0.5mb',
      '',
    )
    expect(result.titleValue).toBe('云主机业务变更')
  })

  it('handles missing 请求节点/工单标题', () => {
    const result = extractStructuralCandidates('普通文本无结构化字段', '')
    expect(result.nodeSegments).toEqual([])
    expect(result.titleValue).toBe('')
    expect(result.candidateKeywords).toEqual([])
  })
})

describe('crossVerifySignals', () => {
  it('returns keywords whose direction is verified by handling, missing from CR', () => {
    // structural: 退订(→退订), 子网(→配置), 安全组(→配置), 变更(→变更)
    // handling: 子网(→配置), 退订(→退订), 配额(→配额)
    // direction overlap: 退订, 配置
    // → 退订 passes (in CR? "客户说子网删不掉" → no), 安全组 passes (配置 direction matches via 子网, not in CR)
    // → 子网 filtered (already in CR), 变更 filtered (方向不匹配)
    const result = crossVerifySignals(
      ['退订', '子网', '安全组', '变更'],
      ['子网', '退订', '配额'],
      '客户说子网删不掉',
    )
    expect(result).toContain('退订')
    expect(result).toContain('安全组') // 配置 direction matches via 子网→配置 in handling
    expect(result).not.toContain('子网') // already in CR
    expect(result).not.toContain('变更') // 变更 direction not in handling
  })

  it('returns empty when no direction overlap', () => {
    const result = crossVerifySignals(['退订'], ['慢', '丢包'], '')
    expect(result).toEqual([])
  })

  it('returns empty when all keywords already in CR', () => {
    const result = crossVerifySignals(['退订', '子网'], ['退订', '子网'], '退订子网')
    expect(result).toEqual([])
  })

  it('returns empty when either input is empty', () => {
    expect(crossVerifySignals([], ['子网'], '')).toEqual([])
    expect(crossVerifySignals(['子网'], [], '')).toEqual([])
  })
})

describe('extractVerifiedSupplementSignals (integration)', () => {
  it('returns verified signal when structural + handling agree but CR lacks it', () => {
    const result = extractVerifiedSupplementSignals({
      rawText: '请求节点：VPC--VPC业务变更\n工单标题：VPC业务变更\n详细内容：子网删不掉',
      handlingText: '经排查，客户子网与路由表网段存在冲突，建议客户使用其他网段创建',
      customerRequest: '子网删不掉，请帮忙处理',
    })
    // 工单标题有"变更"，处理意见有"子网""创建"——"子网"已在CR中，"变更"方向不匹配处理意见
    // "创建"在结构候选中？不在。所以可能返回空或少量信号
    // 实际：结构候选有[VPC, VPC业务变更, 变更, 子网]；处理意见信号有[子网, 创建]
    // 方向交集 = [配置] (子网→配置) 但 [变更]→[变更] 不在处理意见中
    // 所以 verified = 子网但已在CR中 → 空
    // 这是正确行为——标题说"变更"但处理意见说"子网冲突"，方向不一致
    expect(result).toBe('') // 标题"变更"与处理意见"子网冲突"方向不一致
  })

  it('returns signal when structural and handling both point to 退订', () => {
    const result = extractVerifiedSupplementSignals({
      rawText: '请求节点：VPC--VPC退订/取消\n工单标题：VPC退订/取消\n详细内容：vpc删不了',
      handlingText: '已通知客户需要先退订数据库再退订子网',
      customerRequest: 'vpc删不了可用区4的subnet',
    })
    // 结构候选: [VPC, VPC退订/取消, 退订, 删除]
    // 处理意见信号: [退订, 子网]  (退订→[退订], 子网→[配置])
    // 方向交集: [退订]
    // CR中: "vpc删不了可用区4的subnet" — 不含"退订"
    expect(result).toContain('退订')
  })

  it('returns empty when handling is template-only (not verifiable)', () => {
    const result = extractVerifiedSupplementSignals({
      rawText: '请求节点：云主机--云主机业务变更\n工单标题：云主机业务变更',
      handlingText: '敏感信息，请您在工单的机密信息框填写',
      customerRequest: '带宽只跑到0.5mb',
    })
    expect(result).toBe('')
  })

  it('returns empty when handling is empty', () => {
    const result = extractVerifiedSupplementSignals({
      rawText: '请求节点：VPC--VPC业务变更\n工单标题：VPC业务变更',
      handlingText: '',
      customerRequest: '子网删不掉',
    })
    expect(result).toBe('')
  })

  it('returns empty when structural is 全局流转 default', () => {
    const result = extractVerifiedSupplementSignals({
      rawText: '请求节点：全局流转--业务规则咨询/查询-全局流转\n工单标题：业务规则咨询/查询-全局流转',
      handlingText: '经排查，发现是子网冲突导致',
      customerRequest: '网络不通',
    })
    // 结构候选为空（全局流转被过滤），所以无法验证
    expect(result).toBe('')
  })

  it('returns empty when no structural candidates at all', () => {
    const result = extractVerifiedSupplementSignals({
      rawText: '普通受理内容，无请求节点和工单标题',
      handlingText: '经排查，发现是安全组未放通',
      customerRequest: '无法访问',
    })
    expect(result).toBe('')
  })
})
