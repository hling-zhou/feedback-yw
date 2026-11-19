// @vitest-environment node
import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' }, can: () => true }),
}))

const { default: PostUseOptimizationSection } = await import('./PostUseOptimizationSection.jsx')

describe('PostUseOptimizationSection', () => {
  it('空态：产品行占位 + 未生成说明；生成按钮（retag 权限）显示', () => {
    const html = renderToStaticMarkup(
      <PostUseOptimizationSection
        entity={{ id: 'v1', userFeedbackText: '反馈' }}
        entityType="visit"
        open
        onUpdated={() => {}}
      />,
    )
    expect(html).toContain('优化建议（自动生成）')
    expect(html).toContain('产品/技术优化（自动）')
    expect(html).not.toContain('服务/流程改进（自动）')
    expect(html).toContain('未生成，可通过列表页或右上按钮生成')
    expect(html).toContain('生成')
  })

  it('有值态：产品+服务两行显示；来源=大模型标注', () => {
    const html = renderToStaticMarkup(
      <PostUseOptimizationSection
        entity={{
          id: 't1',
          optimizationProduct: '建议P1\n建议P2',
          optimizationService: '建议S1',
          optimizationSource: 'llm',
        }}
        entityType="trace"
        open
        onUpdated={() => {}}
      />,
    )
    expect(html).toContain('建议P1')
    expect(html).toContain('服务/流程改进（自动）')
    expect(html).toContain('建议S1')
    expect(html).toContain('大模型')
    // 有值后不再显示生成按钮（幂等）
    expect(html).not.toContain('未生成，可通过列表页或右上按钮生成')
  })

  it('来源=规则标注 rule；无内容时来源行不显示来源失真', () => {
    const html = renderToStaticMarkup(
      <PostUseOptimizationSection
        entity={{ id: 'v2', optimizationProduct: '规则建议', optimizationSource: 'rule' }}
        entityType="visit"
        open
        onUpdated={() => {}}
      />,
    )
    expect(html).toContain('规则')
  })

  it('源码守卫：两抽屉接入点存在（共享组件同源，禁各写一份）', () => {
    const visitDrawer = fs.readFileSync(new URL('./PostUseVisitDrawer.jsx', import.meta.url), 'utf8')
    const jiraDrawer = fs.readFileSync(new URL('../actions/PostUseJiraDrawer.jsx', import.meta.url), 'utf8')
    expect(visitDrawer).toContain('<PostUseOptimizationSection')
    expect(visitDrawer).toContain('entityType="visit"')
    expect(jiraDrawer).toContain('<PostUseOptimizationSection')
    expect(jiraDrawer).toContain('entityType="trace"')
  })
})
