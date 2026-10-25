import { describe, expect, it } from 'vitest'
import { InsightsProvider, useInsights } from './InsightsContext.jsx'

// 冒烟：模块可编译、导入链完整（不渲染组件，不依赖后端环境）。
// Rosetta 下 antd/xlsx 等导入链冷加载可达数分钟：放 it() 内动态 import 会被
// testTimeout 卡死；顶层静态 import 让加载发生在 collect 阶段（无单测超时约束）。
describe('InsightsContext module smoke', () => {
  it('imports cleanly (syntax + import graph)', () => {
    expect(typeof InsightsProvider).toBe('function')
    expect(typeof useInsights).toBe('function')
  })
})
