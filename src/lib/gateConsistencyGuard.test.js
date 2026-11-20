import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 同构权限一致性守卫（2026-11-20 复盘产物：「产品侧处理反馈」误用 manageTags 门控，
 * partial_editor/viewer 13 天看不到反馈表单；真因 = 同一业务动作在不同模块用了不同权限码）。
 *
 * 判据（docs/conventions/07-权限码语义判据.md）：
 * - 动作客体是**业务记录**（一次性处理事件：工单/失败组/待办/观察项的处理反馈）→ editRecord；
 * - 动作客体是**长期配置资产**（标签库/产品目录/注册表/规则——改一次影响后续全量）→ manageTags；
 * - 复用同组件（如 EstablishedActionFields）或同语义动作的**全部宿主**，门控码必须一致——
 *   判定漂移的必然形态就是「同库同构动作、不同权限码」。
 *
 * 实现形态：登记表驱动（同 menuVisibilityGuard / uiConventionsGuard 先例）——
 * 表里是「共享业务组件 × 全部宿主」与「同构写路由」的**预期门控码**；
 * 新增宿主/新路由时在此登记一行，漏登记由「未登记宿主检测」兜底（扫描 import 发现新宿主即红）。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = join(ROOT, 'src')
const SERVER = join(ROOT, 'server')

const read = (/** @type {string} */ p) => readFileSync(p, 'utf-8')

/** @returns {string[]} 全 src 下 import 该组件的宿主文件（排除测试/组件自身/组件目录兄弟） */
function findHosts(/** @type {string} */ componentBasename) {
  const out = execSync(
    `grep -rl "from '.*${componentBasename}'" src --include="*.jsx" --include="*.js" || true`,
    { cwd: ROOT, encoding: 'utf-8' },
  )
  return out.split('\n').map((s) => s.trim()).filter((s) =>
    s && !s.endsWith(componentBasename) && !s.includes('/actions/') && !s.endsWith('.test.jsx') && !s.endsWith('.test.js'))
}

describe('同构权限一致性守卫（11-20 复盘）', () => {
  it('登记表完整性：每行必填宿主/权限码，权限码只允许已知码', () => {
    for (const row of SHARED_COMPONENT_HOSTS) {
      expect(row.hosts.length, `${row.component} 登记宿主不能为空`).toBeGreaterThan(0)
      expect(KNOWN_WRITE_CODES).toContain(row.code)
    }
    for (const row of ROUTE_GATES) {
      expect(KNOWN_WRITE_CODES).toContain(row.code)
    }
  })

  it('共享组件全宿主门控一致：宿主文件必须含 can(\'<登记码>\') 派生', () => {
    for (const row of SHARED_COMPONENT_HOSTS) {
      for (const host of row.hosts) {
        const src = read(join(SRC, host))
        // 门控形态容许 canEdit = can('<code>') / readOnly = !can('<code>') 两种派生
        const hasGate = new RegExp(`can\\('${row.code}'\\)`).test(src)
        expect(hasGate, `${host} 消费 ${row.component}（${row.code} 动作）但未见 can('${row.code}') 门控——同构权限漂移回潮`).toBe(true)
      }
    }
  })

  it('同构写路由权限码断言：巡检失败组处理闭环 PATCH 必须 editRecord（11-20 拍板）', () => {
    const src = read(join(SERVER, 'routes/patrolQuery.js'))
    expect(src).toMatch(
      /app\.patch\('\/api\/patrol\/failures\/groups\/:id',\s*\{ preHandler: requirePermission\('editRecord'\) \}/,
    )
    // 反向断言：处理反馈写路由若回潮 manageTags 立即红
    expect(src).not.toMatch(
      /app\.patch\('\/api\/patrol\/failures\/groups\/:id',\s*\{ preHandler: requirePermission\('manageTags'\) \}/,
    )
  })

  it('未登记宿主兜底：EstablishedActionFields 新增 import 宿主必须进登记表', () => {
    // 每个新宿主接入共享业务组件 = 新的同构权限判定点——漏进登记表则守卫覆盖面静默缩水
    const hosts = findHosts('EstablishedActionFields')
    for (const h of hosts) {
      const registered = SHARED_COMPONENT_HOSTS.some((row) => row.hosts.includes(h))
      expect(registered, `新宿主 ${h} import EstablishedActionFields 但未登记进 SHARED_COMPONENT_HOSTS——请登记并指定门控码`).toBe(true)
    }
  })

  it('主源码契约：失败请求抽屉 readOnly 派生自 editRecord（复盘锚点防回潮）', () => {
    const src = read(join(SRC, 'components/apiPatrol/ApiPatrolFailuresContent.jsx'))
    expect(src).toMatch(/const readOnly = !can\('editRecord'\)/)
    expect(src).not.toMatch(/const readOnly = !can\('manageTags'\)/)
  })
})

/** 共享业务组件 × 宿主 × 预期门控码（新增宿主在此登记；语义判据见 docs/conventions/07） */
const SHARED_COMPONENT_HOSTS = [
  {
    component: 'EstablishedActionFields（确立举措：库选/手填+排期，投诉咨询/巡检/待办三线共用）',
    code: 'editRecord',
    hosts: [
      'components/FeedbackDrawer.jsx',
      'components/apiPatrol/ApiPatrolFailuresContent.jsx',
    ],
  },
]

/** 同构写路由 × 预期权限码（处理反馈类记录写路由） */
const ROUTE_GATES = [
  { code: 'editRecord' },
]

const KNOWN_WRITE_CODES = ['editRecord', 'retag', 'import', 'manageTags', 'deleteData']
