import { describe, expect, it } from 'vitest'
import {
  classifyRequestScene,
  REQUEST_SCENE_BILLING,
  REQUEST_SCENE_COMPLAINT,
  REQUEST_SCENE_DEFAULT,
  REQUEST_SCENE_FAULT,
  REQUEST_SCENE_GUIDE,
  REQUEST_SCENE_INFO_QUERY,
  REQUEST_SCENE_PRODUCT_INFO,
  REQUEST_SCENE_PROGRESS,
  REQUEST_SCENE_RESOURCE,
  REQUEST_SCENE_SOLUTION,
} from './requestSceneClassifier.js'

/** 对齐 data/请求场景标签体系及打标规则.md §4 混合场景示例 */
const GOLDEN_CASES = [
  ['申请提升IP配额，请尽快审批', REQUEST_SCENE_RESOURCE],
  ['IP不通，要求抓包排查', REQUEST_SCENE_FAULT],
  ['如何退订云主机？', REQUEST_SCENE_GUIDE],
  ['退订时报错，请帮忙处理', REQUEST_SCENE_RESOURCE],
  ['工单提交两天没人回，再不解决就投诉', REQUEST_SCENE_COMPLAINT],
  ['查询IP配额有效期', REQUEST_SCENE_INFO_QUERY],
  ['带宽不够，怎么提升？需联系谁？', REQUEST_SCENE_PRODUCT_INFO],
  ['请设计跨地域容灾方案', REQUEST_SCENE_SOLUTION],
  ['这个月多扣了50元', REQUEST_SCENE_BILLING],
  ['订单状态还是开通中，能帮忙催下吗？', REQUEST_SCENE_PROGRESS],
]

describe('requestSceneClassifier (V2.0)', () => {
  it.each(GOLDEN_CASES)('golden: %j → %s', (text, expected) => {
    expect(classifyRequestScene(text)).toBe(expected)
  })

  it('defaults to 产品信息咨询 when no keyword hits', () => {
    expect(classifyRequestScene('')).toBe(REQUEST_SCENE_DEFAULT)
    expect(classifyRequestScene('   ')).toBe(REQUEST_SCENE_DEFAULT)
    expect(classifyRequestScene('无关键词可匹配的受理说明')).toBe(REQUEST_SCENE_DEFAULT)
  })

  it('matches fault from legacy complaint wording', () => {
    expect(classifyRequestScene('客户报障公网IP无法访问需要排查')).toBe(REQUEST_SCENE_FAULT)
  })

  it('why-slow consult without fault signals → product info', () => {
    expect(classifyRequestScene('为什么慢，规则是什么')).toBe(REQUEST_SCENE_PRODUCT_INFO)
  })

  it('how to view bill → operation guide or product info, not billing', () => {
    const label = classifyRequestScene('如何查看我的账单？')
    expect([REQUEST_SCENE_GUIDE, REQUEST_SCENE_PRODUCT_INFO, REQUEST_SCENE_INFO_QUERY]).toContain(
      label,
    )
    expect(label).not.toBe(REQUEST_SCENE_BILLING)
  })
})
