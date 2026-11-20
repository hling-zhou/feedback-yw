import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  USAGE_MODULE_LABELS,
  USAGE_MODULE_GROUPS,
  USAGE_PATH_RULES,
  resolveUsageModule,
} from './usageModuleMap.js'

/**
 * 埋点映射守卫（2026-11-20 运营分析模块迭代分析产物）。
 *
 * 历史缺口：useUsageTracking.js 与 server/routes/usage.js 曾各持一份手工
 * 镜像映射，11 月新增 /api-patrol/* 与 /mcp-guide 路由两侧均未同步，
 * 巡检域访问全部落入 other 被静默丢弃（usage.db 无巡检记录实证，
 * 与 11-19 群组 cc 字段「主链路加字段、周边消费方不跟进」同构）。
 *
 * 本守卫四道对拍：
 * ① AppShell 导航 leaf 路由（站内可导航项）每条都有映射且不为 other；
 * ② router.jsx 路由表（含动态段路由）同上——防止「导航有但路由表新增页」漏网；
 * ③ 前后端双源共用：usage.js / useUsageTracking.js 源码不再持有独立映射表
 *    （源码正则，防「复制粘贴一份新镜像」回潮）；
 * ④ 模块键取值域三处一致：USAGE_PATH_RULES 的 module 值、LABELS 键、GROUPS 成员。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 从 AppShell.jsx 源码提取全部站内 leaf 导航 key（external/divider/group 不参与） */
function collectNavLeafKeys() {
  const src = read('src/components/AppShell.jsx')
  const keys = []
  const leafRe = /\{ type: 'leaf', key: '([^']+)'/g
  let m
  while ((m = leafRe.exec(src)) !== null) {
    keys.push(m[1])
  }
  return { keys, src }
}

/** 从 router.jsx 源码提取全部路由 path（AppShell 布局内的业务页面，排除 login/change-password/通配/纯重定向） */
function collectRouterPaths() {
  const src = read('src/router.jsx')
  const matches = []
  const routeRe = /\{ path: '([^']+)'/g
  let m
  while ((m = routeRe.exec(src)) !== null) {
    matches.push({ path: m[1], start: m.index })
  }
  const paths = []
  for (let i = 0; i < matches.length; i++) {
    const { path, start } = matches[i]
    if (path === '*' || path === '/' || path === '/login' || path === '/change-password') continue
    // 归属判定：该 path 到下一个 path 匹配之间的片段属于当前路由对象
    // （兄弟路由在数组中顺序排列，片段含该路由的 element 声明）
    const segEnd = i + 1 < matches.length ? matches[i + 1].start : src.length
    if (/element: <Navigate/.test(src.slice(start, segEnd))) continue
    paths.push(path)
  }
  return paths
}

describe('usage 埋点映射守卫', () => {
  it('① AppShell 导航 leaf 每条路由都有映射且不为 other', () => {
    const { keys } = collectNavLeafKeys()
    expect(keys.length).toBeGreaterThanOrEqual(10)
    const missed = keys.filter((k) => resolveUsageModule(k) === 'other')
    expect(missed, `导航路由未登记埋点映射: ${missed.join(', ')}`).toEqual([])
  })

  it('② router.jsx 业务路由（动态段还原为具体段）都能命中映射', () => {
    const paths = collectRouterPaths()
    expect(paths.length).toBeGreaterThanOrEqual(10)
    // 动态段路由还原：workbench/post-use-report-v2/:month → 取该段任意字面量
    const concrete = paths.map((p) => p.replace(/:month/, '2026-10').replace(/:reportId/, 'r1'))
    // router path 不带前导斜杠（嵌套路由相对形态），映射规则以 '/' 开头，补齐再判
    const missed = concrete
      .map((p) => (p.startsWith('/') ? p : '/' + p))
      .filter((p) => resolveUsageModule(p) === 'other')
    expect(missed, `路由表路由未登记埋点映射: ${missed.join(', ')}`).toEqual([])
  })

  it('③ 前后端消费方不再持有独立映射表（防镜像回潮）', () => {
    const server = read('server/routes/usage.js')
    const hook = read('src/hooks/useUsageTracking.js')
    for (const [name, src] of [['server/routes/usage.js', server], ['src/hooks/useUsageTracking.js', hook]]) {
      const rel = name === 'server/routes/usage.js' ? '../../src/lib/usageModuleMap.js' : '../lib/usageModuleMap.js'
      expect(src, `${name} 应 import 共享映射`).toContain(`from '${rel}'`)
      expect(src, `${name} 不得残留独立映射 if 链`).not.toMatch(/page\.startsWith\('\/feedbacks'\)/)
      expect(src, `${name} 不得残留独立映射 if 链`).not.toMatch(/page\.startsWith\('\/operations'\)/)
    }
  })

  it('④ 模块键取值域三处一致（RULES 值域 ⊆ LABELS，GROUPS ⊆ LABELS，无重复）', () => {
    const ruleModules = [...new Set(USAGE_PATH_RULES.map((r) => r.module))]
    const labelKeys = Object.keys(USAGE_MODULE_LABELS)
    const missInLabels = ruleModules.filter((m) => !labelKeys.includes(m))
    expect(missInLabels, `RULES 模块键缺展示标签: ${missInLabels.join(', ')}`).toEqual([])
    const missInGroups = ruleModules.filter(
      (m) => !USAGE_MODULE_GROUPS.includes(m) && m !== 'other',
    )
    expect(missInGroups, `RULES 模块键缺展示分组: ${missInGroups.join(', ')}`).toEqual([])
    expect(new Set(USAGE_MODULE_GROUPS).size).toBe(USAGE_MODULE_GROUPS.length)
  })

  it('核心路径判定回归（含新补的巡检与 MCP 指南）', () => {
    expect(resolveUsageModule('/')).toBe('workbench')
    expect(resolveUsageModule('/workbench/analysis')).toBe('themes')
    expect(resolveUsageModule('/workbench/post-use-report-v2/2026-10')).toBe('workbench')
    expect(resolveUsageModule('/api-patrol/overview')).toBe('api_patrol')
    expect(resolveUsageModule('/api-patrol/failures')).toBe('api_patrol')
    expect(resolveUsageModule('/api-patrol/diagnosis-gaps')).toBe('api_patrol')
    expect(resolveUsageModule('/mcp-guide')).toBe('mcp_guide')
    expect(resolveUsageModule('/feedbacks?tab=x')).toBe('feedbacks')
    expect(resolveUsageModule('/unknown-page')).toBe('other')
    // 边界：裸 startsWith 误吃防护——未来 /tags-foo 类路由不得被 /tags 吞
    expect(resolveUsageModule('/tags-foo')).toBe('other')
  })
})
