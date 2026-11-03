// @ts-check
import { test, expect } from '@playwright/test'

/**
 * 抽屉叠加语义 E2E（2026-11-04 用户报障回归锁）：
 * 业务抽屉内点工单号 → 工单详情抽屉叠加其上（FeedbackDrawer zIndex 1010），
 * 关闭详情后宿主抽屉必须仍在。覆盖两个宿主：
 * ① 产品举措与进展（ActionItemDrawer，本 bug 的报障点）
 * ② 举一反三（GeneralizationTab 详情抽屉，接线缺失的修复点）
 *
 * 种子：e2e/seeds/drawer-stacking-seed.mjs（globalSetup 内联执行，幂等标记
 * product_key='e2e-drawer-stack'；种子写入运行中实例的隔离库，不触碰真实库）。
 */

const ADMIN_USER = 'admin'
const ADMIN_PASS = process.env.E2E_ADMIN_INITIAL_PASSWORD || 'E2eTestPass123!'
const SEED_BASE = process.env.SEED_BASE || 'http://127.0.0.1:3211'

const MARKER = 'e2e-drawer-stack'

/** 最后一行 JSON 即种子上下文 */
async function runSeed() {
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync('node', ['e2e/seeds/drawer-stacking-seed.mjs', SEED_BASE], {
    encoding: 'utf8',
    env: { ...process.env, E2E_ADMIN_INITIAL_PASSWORD: ADMIN_PASS },
  })
  const jsonLine = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{') && l.endsWith('}'))
    .at(-1)
  if (!jsonLine) throw new Error(`种子脚本无 JSON 输出：\n${out}`)
  return JSON.parse(jsonLine)
}

test.beforeAll(async () => {
  await runSeed()
})

/**
 * @param {import('@playwright/test').Page} page
 */
async function loginAsAdmin(page) {
  await page.goto('/login')
  await page.getByPlaceholder('用户名').fill(ADMIN_USER)
  await page.getByPlaceholder('请输入密码').fill(ADMIN_PASS)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/workbench/, { timeout: 30_000 })
}

/**
 * 抽屉叠加核心序列：宿主抽屉内点工单 → 断言两层并存 → 关详情 → 断言宿主仍在。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ hostTrigger: import('@playwright/test').Locator, hostMarker: string | RegExp, ticketLink: import('@playwright/test').Locator }} ctx
 */
async function assertStackingSemantics(page, ctx) {
  // ① 开宿主抽屉
  await ctx.hostTrigger.click()
  const hostDrawer = page.locator('.ant-drawer').filter({ has: page.locator('.ant-drawer-content-wrapper') }).last()
  await expect(page.getByText(ctx.hostMarker)).toBeVisible({ timeout: 20_000 })
  const hostCountBefore = await page.locator('.ant-drawer').count()

  // ② 抽屉内点工单号 → 叠加工单详情抽屉
  await ctx.ticketLink.click()
  // 工单详情抽屉（FeedbackDrawer）挂起后：抽屉数量 +1，且出现工单标题元素
  await expect(page.locator('.ant-drawer')).toHaveCount(hostCountBefore + 1, { timeout: 20_000 })

  // ③ 关闭工单详情抽屉（最上层那个的关闭按钮）
  const detailDrawer = page.locator('.ant-drawer').last()
  await detailDrawer.locator('.ant-drawer-close').click()
  await expect(page.locator('.ant-drawer')).toHaveCount(hostCountBefore, { timeout: 20_000 })

  // ④ 宿主抽屉必须仍在（叠加语义核心断言）
  await expect(page.getByText(ctx.hostMarker)).toBeVisible({ timeout: 10_000 })
}

test.describe('抽屉叠加语义（工单详情抽屉叠在业务抽屉之上，关闭后宿主仍在）', () => {
  test('① 产品举措与进展：举措抽屉内点工单 → 叠加 → 关详情后举措抽屉仍在', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/actions?tab=product')
    await expect(page.getByRole('tab', { name: '产品举措与进展' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })

    // 种子举措行（产品名/内容唯一定位），点行开举措详情抽屉
    const row = page.locator('tr', { hasText: 'E2E叠加：修复功能异常' })
    await expect(row.first()).toBeVisible({ timeout: 30_000 })
    await row.first().click()

    // 抽屉内「关联反馈」分区的工单号按钮
    const ticketLink = page
      .locator('.ant-drawer')
      .last()
      .getByRole('button', { name: /^E2E-DS-/ })
    await expect(ticketLink.first()).toBeVisible({ timeout: 15_000 })

    await assertStackingSemantics(page, {
      hostTrigger: row.first(),
      hostMarker: '举措详情',
      ticketLink: ticketLink.first(),
    })
  })

  test('② 举一反三：详情抽屉内点工单号可点 → 叠加 → 关详情后举一反三抽屉仍在', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/actions?tab=generalization')
    await expect(page.getByRole('tab', { name: '举一反三' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })

    // 种子 issue 行 → 点详情开抽屉
    const row = page.locator('tr', { hasText: 'E2E叠加：功能异常反复出现' })
    await expect(row.first()).toBeVisible({ timeout: 30_000 })
    await row.first().getByRole('button', { name: /详情|E2E叠加：功能异常反复出现/ }).first().click()

    // 抽屉内证据区的工单号按钮（修复点：曾因 onOpenRecord 未接线而是纯文本）
    const ticketLink = page
      .locator('.ant-drawer')
      .last()
      .getByRole('button', { name: /^E2E-DS-/ })
    await expect(ticketLink.first()).toBeVisible({ timeout: 15_000 })

    await assertStackingSemantics(page, {
      hostTrigger: row.first().getByRole('button', { name: /详情|E2E叠加：功能异常反复出现/ }).first(),
      hostMarker: '举一反三问题',
      ticketLink: ticketLink.first(),
    })
  })
})
