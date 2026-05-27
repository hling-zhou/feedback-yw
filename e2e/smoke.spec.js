// @ts-check
import { test, expect } from '@playwright/test'

const ADMIN_USER = 'admin'
const ADMIN_PASS = 'E2eTestPass123!'

/**
 * @param {import('@playwright/test').Page} page
 */
async function loginAsAdmin(page) {
  await page.goto('/login')
  await page.getByPlaceholder('用户名').fill(ADMIN_USER)
  await page.getByPlaceholder('请输入密码').fill(ADMIN_PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/workbench/, { timeout: 30_000 })
}

/**
 * @param {import('@playwright/test').Locator} locator
 */
async function readPeriodCount(locator) {
  await expect(locator).toBeVisible({ timeout: 30_000 })
  const text = (await locator.innerText()).replace(/\s/g, '')
  const match = text.match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

test.describe('smoke', () => {
  test('login and period counts match on insight analysis', async ({ page }) => {
    await loginAsAdmin(page)

    await page.goto('/workbench/analysis')
    await expect(page.getByRole('heading', { name: '洞察分析' })).toBeVisible()

    const sidebarCount = await readPeriodCount(
      page.getByTestId('period-count-sidebar').locator('.ant-statistic-content-value'),
    )
    const headerCount = await readPeriodCount(page.getByTestId('period-count-display'))
    const themesDescCount = await readPeriodCount(page.getByTestId('period-count-themes-desc'))

    expect(headerCount).toBe(sidebarCount)
    expect(themesDescCount).toBe(sidebarCount)
  })
})
