import { describe, expect, it } from 'vitest'

/**
 * customer_type 标注（2026-11-07 用户拍板·终版）：
 * 底稿 4.2 前两条独立判据（或关系），两个弱标签——
 * - 仿真：cmic_ 或 cmic 前缀（忽略大小写）
 * - 测试账号：含 test/ceshi/demo
 * 其余 → 空串（无标记）。仅展示/筛选维度，不影响产品侧处理判定（根因规则驱动）。
 */
import { classifyCustomerType } from './patrolCompress.js'

describe('classifyCustomerType 标注（仿真/测试账号/无标记）', () => {
  it('cmic_ 或 cmic 前缀（忽略大小写）→ 仿真', () => {
    expect(classifyCustomerType('cmic_sim')).toBe('仿真')           // 样例主力仿真账号（1786 条失败）
    expect(classifyCustomerType('cmic_chinamobile')).toBe('仿真')    // EIP/VPC 包仿真账号
    expect(classifyCustomerType('CMIC_x')).toBe('仿真')
    expect(classifyCustomerType('cmic')).toBe('仿真')
  })

  it('非前缀出现 cmic 不命中（子串不算）', () => {
    expect(classifyCustomerType('user_cmic')).toBe('')
  })

  it('含 test/ceshi/demo（忽略大小写）→ 测试账号', () => {
    expect(classifyCustomerType('user_test_01')).toBe('测试账号')
    expect(classifyCustomerType('ceshi_zhang')).toBe('测试账号')
    expect(classifyCustomerType('demo_user')).toBe('测试账号')
    expect(classifyCustomerType('TestRunner')).toBe('测试账号')
  })

  it('真实客户账号 → 空（无标记，不打"普通"标签）', () => {
    expect(classifyCustomerType('YDY15292250571')).toBe('')
    expect(classifyCustomerType('GDQYKJYXGS202604')).toBe('')
    expect(classifyCustomerType('admin')).toBe('')
    expect(classifyCustomerType('jt_zhongduan')).toBe('') // 底稿其余启发式不实现
  })

  it('空 userName → 空（无标记）', () => {
    expect(classifyCustomerType('')).toBe('')
    expect(classifyCustomerType(null)).toBe('')
    expect(classifyCustomerType(undefined)).toBe('')
    expect(classifyCustomerType('   ')).toBe('')
  })
})
