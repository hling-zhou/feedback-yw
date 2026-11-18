import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ActionItemSelect 产品归一层守卫（11-18 拍板：确立举措选择器产品默认选中当前工单产品）。
 *
 * 守卫形态说明：归一化发生在 useState 初始化/effect 内，renderToStaticMarkup 不跑
 * useEffect、也无法断言 Select 初始 value——按 ApiPatrolFailures.render.test 源码断言
 * 先例锁接线：归一函数存在 + 四个应用点全部接线 + 不再存在裸 productKey 直塞路径。
 * 归一函数行为由 resolveProductKeyToCatalog.test.js 六用例红绿证明。
 */
describe('ActionItemSelect 产品归一层（11-18）', () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ActionItemSelect.jsx'),
    'utf-8',
  )

  it('归一函数已导入', () => {
    expect(src).toMatch(/import \{ resolveProductKeyToCatalog \} from '\.\.\/lib\/productCatalog\/resolveProductKeyToCatalog\.js'/)
  })

  it('四个应用点全部接线（初始 state / productKey 同步 / 已选举措回填 / 下拉补充选项）', () => {
    // useState 初始化 + productKey 同步 + 举措回填 三处调用
    expect((src.match(/resolveProductKeyToCatalog\(/g) || []).length).toBeGreaterThanOrEqual(4)
    expect(src).toMatch(/useState\(\(\) => resolveProductKeyToCatalog\(productKey\)\)/)
    expect(src).toMatch(/setSelectedProductKey\(resolveProductKeyToCatalog\(productKey\)\)/)
    expect(src).toMatch(/setSelectedProductKey\(resolveProductKeyToCatalog\(item\.productKey\)\)/)
    // 选项构建：补充项基于归一化结果（防"归一了选中值、选项还是老逻辑"的半吊子接线）
    expect(src).toMatch(/const pk = resolveProductKeyToCatalog\(currentProductKey\)/)
  })

  it('归一后 key 通道不再有裸 productKey 直塞', () => {
    // 旧形态回潮即红：产品下拉选中值/初始化直接用原始 productKey
    expect(src).not.toMatch(/useState\(\(\) => productKey\?\.trim\(\) \|\| ''\)/)
    expect(src).not.toMatch(/setSelectedProductKey\(productKey\?\.trim\(\) \|\| ''\)/)
    expect(src).not.toMatch(/setSelectedProductKey\(item\.productKey\.trim\(\)\)/)
  })

  it('补充项 label 优先目录中文名（disabled 产品不裸显英文 key）', () => {
    expect(src).toMatch(/getCatalogProduct\(pk\)\?\.name/)
  })
})
