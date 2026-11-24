import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 11-23 复盘守卫（深夜失误链四实锤的确定性防线）：
 * ① import 深度（server/issueLinkAutoJudge ../ 误抄）——server 根目录文件的相对 import
 *    逐条解析目标必须真实存在；
 * ② LLM 解析器自写轮子（issueLinkVerdict 曾自写 content 提取）——全仓禁止绕过
 *    getLlmCompletionText 直接读 message.content 做 JSON 提取；
 * ③ 前后端契约断裂（/links/auto 响应改计数后前端仍读 verdicts）——auto 路由响应
 *    字段与 Linker 组件消费字段对拍。
 */

// vitest 从仓库根运行——process.cwd() 稳定指向仓库根（import.meta.url 在变换下不可靠）
const REPO_ROOT = process.cwd()
const SERVER_ROOT = join(REPO_ROOT, 'server')

/** 从文件内容提取所有静态相对 import 说明符 */
function relativeImportsOf(filePath) {
  const source = readFileSync(filePath, 'utf8')
  const specs = []
  const re = /from\s+['"](\.[^'"]+)['"]/g
  let match
  while ((match = re.exec(source)) !== null) specs.push(match[1])
  const dynRe = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g
  while ((match = dynRe.exec(source)) !== null) specs.push(match[1])
  return specs
}

describe('11-23 复盘守卫：import 深度 / 解析器单源 / 前后端契约', () => {
  it('server 根目录全部 .js 文件的相对 import 逐条可达（新建文件复制 import 深度错误即红）', () => {
    const failures = []
    for (const name of readdirSync(SERVER_ROOT)) {
      const full = join(SERVER_ROOT, name)
      // 只扫生产代码——测试文件说明符按仓库根写、偏移规则不同（首轮误报实锤）
      if (!name.endsWith('.js') || name.endsWith('.test.js') || !statSync(full).isFile()) continue
      // 动态 import 解析（mjs 运行时行为）在此只做存在性核对：相对说明符逐条解析到真实文件
      for (const spec of relativeImportsOf(full)) {
        const target = join(SERVER_ROOT, spec)
        const candidates = [target, `${target}.js`, join(target, 'index.js')]
        if (!candidates.some((c) => { try { return statSync(c).isFile() } catch { return false } })) {
          failures.push(`${name} → ${spec}`)
        }
      }
    }
    expect(failures, `不可达 import：\n${failures.join('\n')}`).toEqual([])
  })

  it('issueLinkVerdict 消费 LLM 响应必走 getLlmCompletionText（自写 content 提取回潮即红）', () => {
    const source = readFileSync(join(SERVER_ROOT, '..', 'src', 'lib', 'postUseRating', 'issueLinkVerdict.js'), 'utf8')
    expect(source).toContain('getLlmCompletionText')
    expect(source).not.toMatch(/choices\??\.\[0\]\??\.message\??\.content/)
  })

  it('/links/auto 响应契约：前端 Linker 消费的字段必须出现在服务端响应里（计数契约对拍）', () => {
    const route = readFileSync(join(SERVER_ROOT, 'routes', 'postUseReport.js'), 'utf8')
    const linker = readFileSync(join(SERVER_ROOT, '..', 'src', 'components', 'feedbacks', 'PostUseReportIssueLinker.jsx'), 'utf8')
    // 服务端响应的 message/saved/skippedManual 是契约面
    for (const field of ['saved', 'skippedManual', 'message']) {
      expect(route, `服务端响应缺 ${field}`).toContain(field)
    }
    // 前端不得再按旧契约读 verdicts 数组
    expect(linker, '前端回潮读旧 verdicts 数组契约').not.toMatch(/result\?\.verdicts/)
    // 前端透传后端 message
    expect(linker).toContain('result?.message')
  })
})
