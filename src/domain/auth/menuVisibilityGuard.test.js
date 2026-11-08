import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 菜单可见性守卫（11-08 会诊 D-3，11-02 拍板约定补防）。
 *
 * 拍板口径：新增菜单项**默认对所有角色可见**——禁止想当然把新入口塞进
 * ROLE_HIDDEN_ROUTES 隐藏列表；只有用户明确说隐藏、或按需求逻辑应对某角色
 * 隐藏（并主动提醒用户确认）时才隐藏。
 *
 * 守卫形态：解析 ROLE_HIDDEN_ROUTES 每条隐藏路由，必须带 [HIDDEN-WHY]
 * 理由注释——无理由的隐藏条目即红（防「顺手隐藏」回潮）。理由注释同时是
 * 审计线索：未来读到该条的人能看到当初为什么藏。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// 本文件位于 src/domain/auth/ → ROOT 即 src/；permissions.js 与本测试同目录
const PERM_FILE = join(dirname(fileURLToPath(import.meta.url)), 'permissions.js')
const source = readFileSync(PERM_FILE, 'utf8')

const { ROLE_HIDDEN_ROUTES, canAccessRoute } = await import('./permissions.js')

describe('菜单可见性守卫（11-02 拍板：默认全可见，隐藏须有理由）', () => {
  it('ROLE_HIDDEN_ROUTES 每条隐藏路由必须带 [HIDDEN-WHY] 理由注释（同一行）', () => {
    /** @type {string[]} */
    const missingWhy = []
    for (const [role, routes] of Object.entries(ROLE_HIDDEN_ROUTES)) {
      for (const route of routes) {
        // 定位该条目所在行，理由注释必须与条目同一行（前一行是别的条目时会造成误判——
        // 红绿证明曾抓出此假守卫形态，故收紧为同行断言）
        const lines = source.split('\n')
        const idx = lines.findIndex((l) => l.includes(`'${route}'`))
        if (idx < 0) continue // 解析定位失败不误报
        if (!lines[idx].includes('[HIDDEN-WHY]')) {
          missingWhy.push(`${role}: '${route}'`)
        }
      }
    }
    expect(
      missingWhy,
      `以下隐藏路由缺 [HIDDEN-WHY] 理由注释（11-02 拍板：新增菜单默认全角色可见；要隐藏必须在条目同行写明理由，请补注释或从 ROLE_HIDDEN_ROUTES 删除该条）：\n${missingWhy.join('\n')}`,
    ).toEqual([])
  })

  it('admin 默认零隐藏（管理员看全量菜单是默认约定）', () => {
    expect(ROLE_HIDDEN_ROUTES.admin).toEqual([])
  })

  it('canAccessRoute 前缀匹配语义：/users/1 也会被 /users 隐藏覆盖（防子路径逃逸）', () => {
    expect(canAccessRoute('viewer', '/users')).toBe(false)
    expect(canAccessRoute('viewer', '/users/1')).toBe(false)
    expect(canAccessRoute('viewer', '/usersettings')).toBe(true) // 前缀需精确到段
    expect(canAccessRoute('admin', '/operations')).toBe(true)
    expect(canAccessRoute('viewer', '/feedbacks')).toBe(true) // 默认可见的路由不受隐藏表影响
  })
})
