import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * team 枚举三段同步守卫（11-08 会诊 D-2，裸奔约定补防）。
 *
 * 拍板口径：team 17 项枚举真源 = src/domain/userProfile.js（TEAMS）；
 * 三段链路 = ① server/schemas/userSchemas.js（类型声明）
 *          → ② server/index.js POST/批量路由处理器逐字段解构透传
 *          → ③ server/users.js 业务函数用 isKnownTeam 校验。
 *
 * 风险形态（POST /api/users 逐字段解构是危险点——记忆拍板）：
 *   - 新增 team 项时有人在 users.js 硬编码第二份名单 → 两套名单漂移；
 *   - 路由解构漏 team 字段 → 静默丢字段（单测抓不到，绕过路由层）；
 *   - userSchemas 把 team 改成硬编码 enum → 与真源漂移。
 *
 * 守卫形态：真 import 用户档案真源，对三段做结构与源码扫描断言。
 * 新增角色/字段/班组时的同步破坏会让本守卫红。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

// 动态 import 真源（保证与运行时同源，不复制名单）
const { TEAMS, isKnownTeam } = await import('../src/domain/userProfile.js')

describe('team 枚举三段同步守卫（会诊 D-2）', () => {
  it('真源健康：TEAMS 非空且无重复', () => {
    expect(TEAMS.length).toBeGreaterThan(0)
    expect(new Set(TEAMS).size).toBe(TEAMS.length)
    // 历史值校验（存量迁移后这些旧值不应出现在枚举）
    expect(isKnownTeam('测试')).toBe(false)
    expect(isKnownTeam('管理')).toBe(false)
    expect(isKnownTeam('查看')).toBe(false)
  })

  it('段③ 业务层：users.js 必须走真源校验（import isKnownTeam + 调用），禁止硬编码第二份名单', () => {
    const source = read('server/users.js')
    // 必须从真源 import（防有人删 import 改硬编码）
    expect(source).toMatch(/import\s*\{[^}]*isKnownTeam[^}]*\}\s*from\s*'\.\.\/src\/domain\/userProfile\.js'/)
    // 必须实际调用校验（防 import 了但不用）
    expect(source).toMatch(/isKnownTeam\(/)
    // 禁止硬编码名单形态：班组数组字面量含「产品组/团队/支撑组」等枚举特征词
    const hardcoded = source.match(/\[\s*['"][^'"]*(产品组|平台模块团队|管理组)['"][^\]]*\]/g) || []
    expect(hardcoded, `users.js 出现疑似硬编码班组名单（应只走 userProfile.js 真源）：\n${hardcoded.join('\n')}`).toEqual([])
  })

  it('段② 路由层：POST /api/users 与批量路由必须解构透传 team（防静默丢字段）', () => {
    const source = read('server/index.js')
    // 单条创建：解构形态里必须有 team 透传
    const singleMatch = source.match(/const user = await createUser\(\{\s*[\s\S]*?team: body\.team/)
    expect(singleMatch, 'POST /api/users 解构缺 team: body.team 透传——新增/修改字段时漏解构会静默丢字段（项目拍板危险点）').not.toBeNull()
    // 批量创建：batchCreateUsers(body.users) 必须整体透传（不逐字段重解构）
    expect(source).toMatch(/batchCreateUsers\(body\.users\)/)
  })

  it('段① schema 层：userSchemas 的 team 必须为 string 类型（枚举校验属业务层，schema 不做名单）', () => {
    const source = read('server/schemas/userSchemas.js')
    const teamSchema = source.match(/team:\s*\{[^}]*\}/g) || []
    expect(teamSchema.length).toBeGreaterThan(0)
    for (const seg of teamSchema) {
      expect(seg).toMatch(/type:\s*'string'/)
      // schema 层禁止 enum 硬编码名单（名单真源在 userProfile.js，schema 做 enum 会漂移）
      expect(seg).not.toMatch(/enum:\s*\[/)
    }
  })

  it('消费面一致性：全仓（server/）不得出现 TEAMS 名单的硬编码副本', () => {
    // 找出真源以外、含枚举特征值的文件（疑似第二份名单）
    let offenders = []
    try {
      const out = execSync(
        `grep -rl "天池NFV平台模块团队" server/ --include="*.js" | grep -v userProfile.js || true`,
        { cwd: ROOT, encoding: 'utf8' },
      )
      offenders = out.split('\n').filter(Boolean).filter((f) => !f.endsWith('.test.js'))
    } catch {
      offenders = []
    }
    expect(
      offenders,
      `以下 server 文件硬编码了班组枚举成员（应 import userProfile.js 真源）：\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
