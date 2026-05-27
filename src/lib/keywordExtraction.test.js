import { describe, it, expect } from 'vitest'
import {
  isMeaninglessKeyword,
  stripTicketBoilerplate,
  textForKeywordExtraction,
  tokenizeForKeywords,
} from './keywordExtraction.js'
import { topKeywords } from './themes.js'

describe('keywordExtraction', () => {
  it('filters courtesy and system phrases', () => {
    expect(isMeaninglessKeyword('谢谢')).toBe(true)
    expect(isMeaninglessKeyword('协助请求')).toBe(true)
    expect(isMeaninglessKeyword('uuid')).toBe(true)
    expect(isMeaninglessKeyword('Mbps')).toBe(true)
    expect(isMeaninglessKeyword('测试')).toBe(true)
    expect(isMeaninglessKeyword('客户侧')).toBe(true)
    expect(isMeaninglessKeyword('ipv')).toBe(true)
    expect(isMeaninglessKeyword('联系电话')).toBe(true)
    expect(isMeaninglessKeyword('预处理')).toBe(true)
    expect(isMeaninglessKeyword('追加时间')).toBe(true)
    expect(isMeaninglessKeyword('追加内容')).toBe(true)
    expect(
      isMeaninglessKeyword('麻烦客服老师将工单转给后台技术老师帮忙删除资源'),
    ).toBe(true)
    expect(isMeaninglessKeyword('帮忙删除资源')).toBe(true)
    expect(isMeaninglessKeyword('不涉及')).toBe(true)
    expect(isMeaninglessKeyword('云技术专家核实')).toBe(true)
    expect(isMeaninglessKeyword('处理人')).toBe(true)
    expect(isMeaninglessKeyword('协办')).toBe(true)
    expect(isMeaninglessKeyword('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true)
    expect(isMeaninglessKeyword('带宽')).toBe(false)
    expect(isMeaninglessKeyword('无法访问')).toBe(false)
  })

  it('tokenizeForKeywords drops noise', () => {
    const tokens = tokenizeForKeywords(
      '谢谢客服协助请求 uuid 公网IP无法访问 带宽不足',
    )
    expect(tokens).toContain('无法访问')
    expect(tokens).not.toContain('谢谢')
    expect(tokens).not.toContain('协助请求')
    expect(tokens).not.toContain('uuid')
  })

  it('stripTicketBoilerplate removes CS handoff template', () => {
    const text = stripTicketBoilerplate(
      '麻烦客服老师将工单转给后台技术老师帮忙删除资源\n云专线带宽不足无法扩容',
    )
    expect(text).toContain('带宽不足')
    expect(text).not.toMatch(/麻烦客服/)
    expect(text).not.toMatch(/帮忙删除资源/)
  })

  it('textForKeywordExtraction prefers problem summary over raw boilerplate', () => {
    const text = textForKeywordExtraction({
      problemSummary: '云专线跨省链路丢包严重',
      customerQuote: '',
      rawText: '请求节点-服务类型：协助请求\n工单标题：谢谢\n【处理意见】已处理',
    })
    expect(text).toContain('丢包')
    expect(text).not.toMatch(/协助请求/)
  })

  it('topKeywords excludes operational workflow tokens', () => {
    const list = topKeywords(
      [
        {
          id: '1',
          problemSummary: '云主机无法远程登录',
          customerQuote: '不涉及 协办 处理人 云技术专家核实',
        },
        {
          id: '2',
          problemSummary: '云主机无法远程登录',
          customerQuote: '远程登录失败端口不通',
        },
      ],
      10,
    )
    const words = list.map((k) => k.word)
    expect(words.some((w) => w.includes('远程') || w.includes('登录') || w.includes('端口'))).toBe(
      true,
    )
    expect(words).not.toContain('不涉及')
    expect(words).not.toContain('协办')
    expect(words).not.toContain('处理人')
    expect(words).not.toContain('云技术专家核实')
  })

  it('topKeywords excludes meaningless tokens from ticket template', () => {
    const list = topKeywords(
      [
        {
          id: '1',
          problemSummary: '云专线带宽不足无法扩容',
          customerQuote: '谢谢 协助请求 uuid',
          rawText: '请求节点-服务类型：协助请求',
        },
        {
          id: '2',
          problemSummary: '云专线带宽不足无法扩容',
          customerQuote: '跨省链路丢包',
          rawText: '',
        },
      ],
      10,
    )
    const words = list.map((k) => k.word)
    expect(words.some((w) => w.includes('云专线') && w.includes('带宽'))).toBe(true)
    expect(words).toContain('跨省链路丢包')
    expect(words).not.toContain('谢谢')
    expect(words).not.toContain('协助请求')
    expect(words).not.toContain('uuid')
  })
})
