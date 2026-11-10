import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 「省代表回访」勾选列行级化守卫（2026-11-09 用户拍板：与产品部回溯列一致，不做合并）。
 * 红绿：改动前问卷 tab 用 visitFlagColumn（客户级 rowSpan 合并 + 组内一勾全选 + 半选态
 * + "已纳入（部分）"组级 Tag）→ 断言红；改动后行级 flagColumn → 绿。
 */

const source = fs.readFileSync(
  new URL('./PostUseCallbackProcessModal.jsx', import.meta.url),
  'utf8',
)

describe('PostUseCallbackProcessModal 省代表回访列行级化（2026-11-09）', () => {
  it('两个 tab 的省代表回访列都用行级 flagColumn（与投诉 tab 同款）', () => {
    // 问卷 tab 列定义（questionnaireColumns）与投诉 tab（callbackColumns）各一处
    const occurrences = source.match(/flagColumn\('needCustomerVisit', '省代表回访'\)/g) || []
    expect(occurrences).toHaveLength(2)
  })

  it('客户级合并勾选列 visitFlagColumn 已删除（防回潮）', () => {
    // 源码与注释中允许出现历史说明，但不得再有函数定义或调用
    expect(source).not.toMatch(/const visitFlagColumn/)
    expect(source).not.toMatch(/visitFlagColumn\(/)
  })

  it('组内批量勾选 persistDecisionsBatch 已删除（唯一消费方是原合并列）', () => {
    expect(source).not.toMatch(/const persistDecisionsBatch/)
    expect(source).not.toMatch(/persistDecisionsBatch\(/)
  })

  it('半选态与组级"已纳入（部分）"Tag 已下线', () => {
    expect(source).not.toContain('indeterminate')
    expect(source).not.toContain('已纳入{all ? \'\' : \'（部分）\'}')
  })

  it('dispatchedCount 与 filterDispatchedOnly 均为行级判定（计数=筛选后显示行数）', () => {
    // 问卷 tab 行级过滤（与投诉 tab 同款谓词），不再走 __groupKeys.some 组级匹配
    expect(source).toContain('if (filterDispatchedOnly && !isDispatched(row.itemKey || \'\')) return false')
    // 行级计数：不再出现 __groupKeys.some((k) => isDispatched(k))
    expect(source).not.toContain('(row.__groupKeys || []).some((k) => isDispatched(k))')
  })

  it('显示列客户级合并保留（mergedCell + 分组信息重建仍在）', () => {
    expect(source).toContain('const mergedCell = (value, row, render) =>')
    expect(source).toContain('__isGroupFirst')
    expect(source).toContain('__groupSpan')
    // 客户名称/客户编码/触发类型三个显示列仍走 mergedCell
    expect(source.match(/mergedCell\(/g) || []).not.toHaveLength(0)
  })

  it('行级勾选走 persistDecision（周期包含同步 + 失败回滚）不变', () => {
    expect(source).toContain('const persistDecision = async (itemKey, sourceType, patch) =>')
    expect(source).toContain('const related = allMatchingKeys(decisions, itemKey)')
  })
})
