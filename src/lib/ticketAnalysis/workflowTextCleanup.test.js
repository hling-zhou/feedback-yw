import { describe, expect, it } from 'vitest'
import { stripInternalWorkflowPrefix } from './workflowTextCleanup.js'

describe('stripInternalWorkflowPrefix', () => {
  it('removes internal group prefixes', () => {
    expect(stripInternalWorkflowPrefix('开始&客服组：客户反馈专线不通，请排查。')).toBe(
      '客户反馈专线不通，请排查。',
    )
  })

  it('removes chained prefixes', () => {
    expect(
      stripInternalWorkflowPrefix('首处理&应用一组：客户反馈EIP已绑定成功，但外网访问8085端口不通。'),
    ).toBe('客户反馈EIP已绑定成功，但外网访问8085端口不通。')
  })

  it('does not strip customer text before a later 协办 segment', () => {
    expect(
      stripInternalWorkflowPrefix(
        '开始&客服组：客户反馈专线不通，请排查。协办&网络组：已联系客户，客户表示稍后提供拓扑。',
      ),
    ).toBe('客户反馈专线不通，请排查。协办&网络组：已联系客户，客户表示稍后提供拓扑。')
  })
})
