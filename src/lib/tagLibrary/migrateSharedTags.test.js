import { describe, it, expect } from 'vitest'
import {
  migrateSharedTagsInSnapshot,
  migrateSharedTagsOnRecord,
  migrateProblemTypeLabel,
} from './migrateSharedTags.js'
import {
  REQUEST_SCENES_BUILTIN,
  PROBLEM_TYPES_BUILTIN,
  PROBLEM_TYPE_LABEL_MIGRATION,
} from '../sharedTagDefs.js'

/** 旧 9 类（public/config/taxonomy/index.json v3）→ 12 类 */
const OLD_NINE_CLASS_MIGRATION = {
  可用性与连通性: '可用性/连通性故障',
  性能与质量: '性能问题',
  功能异常与缺陷: '可用性/连通性故障',
  功能需求与规划: '产品功能需求',
  配置与对接: '配置与操作',
  资源与配额: '资源开通与创建',
  计费与商务: '计费与账单',
  安全与合规: '可用性/连通性故障',
  易用性体验: '界面与操作易用性',
}

describe('migrateSharedTags', () => {
  it('replaces legacy request scenes with v2 builtins', () => {
    const snapshot = {
      sharedRequestScenes: [{ label: '报障排障', keywords: ['old'] }],
      sharedProblemTypes: [],
      products: {},
    }
    expect(migrateSharedTagsInSnapshot(snapshot)).toBe(true)
    expect(snapshot.sharedRequestScenes.map((t) => t.label)).toEqual(
      REQUEST_SCENES_BUILTIN.map((t) => t.label),
    )
    expect(
      snapshot.sharedRequestScenes.find((t) => t.label === '报障与恢复')?.keywords,
    ).toContain('报障')
  })

  it('replaces legacy problem types with 12-class builtins', () => {
    const snapshot = {
      sharedRequestScenes: [],
      sharedProblemTypes: [
        { label: '可用性/连通性', keywords: [] },
        { label: '性能类', keywords: [] },
      ],
      products: {},
    }
    migrateSharedTagsInSnapshot(snapshot)
    expect(snapshot.sharedProblemTypes.map((t) => t.label)).toEqual(
      PROBLEM_TYPES_BUILTIN.map((t) => t.label),
    )
  })

  it('replaces all legacy 9-class problem types in snapshot', () => {
    const snapshot = {
      sharedRequestScenes: [],
      sharedProblemTypes: Object.keys(OLD_NINE_CLASS_MIGRATION).map((label) => ({
        label,
        keywords: [],
      })),
      products: {},
    }
    migrateSharedTagsInSnapshot(snapshot)
    expect(snapshot.sharedProblemTypes.map((t) => t.label)).toEqual(
      PROBLEM_TYPES_BUILTIN.map((t) => t.label),
    )
  })

  it('migrates record requestScene and problemType labels', () => {
    const record = {
      requestScene: '报障排障',
      problemType: '性能与稳定性',
    }
    expect(migrateSharedTagsOnRecord(record)).toBe(true)
    expect(record.requestScene).toBe('报障与恢复')
    expect(record.problemType).toBe('性能问题')
  })

  it('migrates 未分类/无法识别 problem types to 其他', () => {
    for (const old of ['未分类', '无法识别']) {
      const record = { problemType: old }
      expect(migrateSharedTagsOnRecord(record)).toBe(true)
      expect(record.problemType).toBe('其他')
    }
  })

  it('is idempotent for records already on 12-class labels', () => {
    const record = {
      requestScene: '报障与恢复',
      problemType: '可用性/连通性故障',
    }
    expect(migrateSharedTagsOnRecord(record)).toBe(false)
    expect(record.problemType).toBe('可用性/连通性故障')
  })

  it('PROBLEM_TYPE_LABEL_MIGRATION covers all legacy 9-class labels', () => {
    for (const [old, expected] of Object.entries(OLD_NINE_CLASS_MIGRATION)) {
      expect(PROBLEM_TYPE_LABEL_MIGRATION[old]).toBe(expected)
      expect(migrateProblemTypeLabel(old)).toBe(expected)
    }
  })
})
