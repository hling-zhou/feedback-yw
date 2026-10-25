import { describe, expect, it } from 'vitest'
import { buildUserOption, userOptionFilterOption } from './userSelectOptions.js'

const users = [
  { id: 'u1', username: 'zhangsan', displayName: '张三' },
  { id: 'u2', username: 'lisi', displayName: '' },
  { id: 'u3', username: 'zhangsan01', displayName: '张三' },
  { id: 'u4', username: 'wangwu' },
]

describe('buildUserOption', () => {
  it('中文名优先作为 label，同时挂 username/displayName', () => {
    const option = buildUserOption(users[0], users)
    expect(option.label).toBe('张三(zhangsan)') // 与 u3 重名，消歧
    expect(option.value).toBe('u1')
    expect(option.username).toBe('zhangsan')
    expect(option.displayName).toBe('张三')
  })

  it('displayName 为空串时回退 username', () => {
    const option = buildUserOption(users[1], users)
    expect(option.label).toBe('lisi')
  })

  it('无 displayName 字段时回退 username', () => {
    const option = buildUserOption(users[3], users)
    expect(option.label).toBe('wangwu')
  })

  it('非重名用户不消歧', () => {
    const option = buildUserOption(users[1], [users[1]])
    expect(option.label).toBe('lisi')
  })

  it('allUsers 缺省时不报错且不消歧', () => {
    const option = buildUserOption(users[0])
    expect(option.label).toBe('张三')
  })
})

describe('userOptionFilterOption', () => {
  const zhang = buildUserOption({ id: 'u9', username: 'zhangsan', displayName: '张三' })

  it('匹配 label（中文名）', () => {
    expect(userOptionFilterOption('张三', zhang)).toBe(true)
    expect(userOptionFilterOption('李四', zhang)).toBe(false)
  })

  it('匹配 username 子串且大小写不敏感', () => {
    expect(userOptionFilterOption('ZHANG', zhang)).toBe(true)
    expect(userOptionFilterOption('gsa', zhang)).toBe(true)
    expect(userOptionFilterOption('lisi', zhang)).toBe(false)
  })

  it('匹配 displayName', () => {
    const option = { label: '张三(zhangsan01)', username: 'zhangsan01', displayName: '张三' }
    expect(userOptionFilterOption('张三', option)).toBe(true)
  })

  it('空输入或空白输入返回 true', () => {
    expect(userOptionFilterOption('', zhang)).toBe(true)
    expect(userOptionFilterOption('   ', zhang)).toBe(true)
  })

  it('兼容 option 原始数据包在 data 里的形态', () => {
    expect(userOptionFilterOption('zhang', { data: zhang })).toBe(true)
    expect(userOptionFilterOption('li', { data: zhang })).toBe(false)
  })

  it('输入未命中任何字段返回 false', () => {
    expect(userOptionFilterOption('nonexistent', zhang)).toBe(false)
  })
})
