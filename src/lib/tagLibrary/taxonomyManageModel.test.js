import { describe, it, expect } from 'vitest'
import {
  mergeImportByKey,
  validateTaxonomyImport,
  problemTypeRowId,
  journeyRowId,
  formatMergeImportResultMessage,
} from './taxonomyManageModel.js'
import * as XLSX from 'xlsx'

function buildMinimalWorkbook() {
  const wb = XLSX.utils.book_new()
  const wsP = XLSX.utils.json_to_sheet([
    { 问题类型名称: '新问题', 参考关键词: 'a,b' },
    { 问题类型名称: '', 参考关键词: '仅有词无名称' },
  ])
  XLSX.utils.book_append_sheet(wb, wsP, '通用问题类型')
  const wsJ = XLSX.utils.json_to_sheet([
    {
      产品Key: 'eip',
      一级ID: 'open',
      一级名称: '开通',
      二级ID: 'new-step',
      二级名称: '新环节',
      参考关键词: 'k1',
    },
  ])
  XLSX.utils.book_append_sheet(wb, wsJ, '用户旅程')
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}

describe('taxonomyManageModel', () => {
  it('problemTypeRowId and journeyRowId are stable', () => {
    expect(problemTypeRowId('计费')).toBe('pt::计费')
    expect(journeyRowId('eip', '开通', '配置')).toBe('j::eip::开通::配置')
  })

  it('validateTaxonomyImport rejects empty problem type names', () => {
    const buf = buildMinimalWorkbook()
    const result = validateTaxonomyImport(buf)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('不能为空'))).toBe(true)
  })

  it('mergeImportByKey updates existing keys', () => {
    const current = {
      tagLibraryVersion: 'v1',
      updatedAt: '2020-01-01',
      sharedRequestScenes: [{ label: '报障', description: '旧说明', keywords: ['a'] }],
      sharedProblemTypes: [{ label: '新问题', description: '旧', keywords: [] }],
      products: {
        eip: {
          key: 'eip',
          name: 'EIP',
          match: [],
          journeys: [
            {
              id: 'open',
              label: '旧一级名',
              description: '旧一级说明',
              children: [
                {
                  id: 'new-step',
                  label: '旧二级名',
                  description: '旧二级说明',
                  keywords: ['old'],
                },
              ],
            },
          ],
        },
      },
    }
    const parsed = {
      sharedRequestScenes: [{ label: '报障', description: '新说明', keywords: ['x'] }],
      sharedProblemTypes: [{ label: '新问题', description: '新说明', keywords: ['x'] }],
      products: {
        eip: {
          key: 'eip',
          name: 'EIP',
          journeys: [
            {
              id: 'open',
              label: '开通',
              description: '新一级说明',
              children: [
                {
                  id: 'new-step',
                  label: '新环节',
                  description: '新二级说明',
                  keywords: ['k1'],
                },
              ],
            },
          ],
        },
      },
    }
    const working = JSON.parse(JSON.stringify(current))
    const { updated, added } = mergeImportByKey(working, parsed)
    expect(updated.requestScenes).toBe(1)
    expect(updated.problemTypes).toBe(1)
    expect(updated.journeys).toBe(1)
    expect(added.requestScenes).toBe(0)
    expect(added.problemTypes).toBe(0)
    expect(added.journeys).toBe(0)
    expect(working.sharedRequestScenes[0].description).toBe('新说明')
    expect(working.sharedRequestScenes[0].keywords).toEqual(['x'])
    expect(working.sharedProblemTypes[0].description).toBe('新说明')
    expect(working.products.eip.journeys[0].label).toBe('开通')
    expect(working.products.eip.journeys[0].description).toBe('新一级说明')
    expect(working.products.eip.journeys[0].children[0].label).toBe('新环节')
    expect(working.products.eip.journeys[0].children[0].keywords).toEqual(['k1'])
  })

  it('mergeImportByKey adds new keys', () => {
    const current = {
      tagLibraryVersion: 'v1',
      updatedAt: '2020-01-01',
      sharedRequestScenes: [],
      sharedProblemTypes: [],
      products: { eip: { key: 'eip', name: 'EIP', match: [], journeys: [] } },
    }
    const parsed = {
      sharedRequestScenes: [{ label: '咨询', description: 'd', keywords: ['k'] }],
      sharedProblemTypes: [{ label: '全新类型', keywords: ['k'] }],
      products: {
        eip: {
          key: 'eip',
          journeys: [
            {
              id: 'x',
              label: '环节A',
              children: [{ id: 'y', label: '环节B', keywords: [] }],
            },
          ],
        },
      },
    }
    const { added } = mergeImportByKey(current, parsed)
    expect(added.requestScenes).toBe(1)
    expect(added.problemTypes).toBe(1)
    expect(added.journeys).toBe(1)
    expect(current.sharedProblemTypes[0].label).toBe('全新类型')
  })

  it('formatMergeImportResultMessage summarizes counts', () => {
    const text = formatMergeImportResultMessage({
      added: { requestScenes: 1, problemTypes: 0, journeys: 2 },
      updated: { requestScenes: 0, problemTypes: 1, journeys: 3 },
    })
    expect(text).toContain('新增 请求场景 1')
    expect(text).toContain('问题类型 1、旅程 3')
  })
})
