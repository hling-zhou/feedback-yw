import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildImportDataTemplate,
  hasImportDataTemplate,
} from './importDataTemplate.js'
import { detectPreset } from './columnPresets.js'
import {
  MOBILE_CLOUD_TICKET_PRESET,
  CONSULTATION_TICKET_PRESET,
  USER_SURVEY_PRESET,
  GENERIC_PRESET,
  POST_USE_CUSTOMER_VISIT_PRESET,
} from './columnPresets.js'
import {
  POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE,
  POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT,
  POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK,
} from '../domain/postUseRatingImport.js'

/**
 * 模板真实链路守卫：模板产物必须能被导入解析自动识别（detectPreset 命中对应 preset）。
 * 列名若与 preset columnMap 漂移（加必填标记、改列名），模板下载后无法自动映射——本守卫即红。
 */

/** 用 parseFile 的读法（sheet_to_json 默认模式）从模板字节读回列头 */
function readTemplateHeaders(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const json = XLSX.utils.sheet_to_json(wb.Sheets['数据填写'])
  return {
    sheetNames: wb.SheetNames,
    headers: Object.keys(json[0] || {}),
    guideFirstRow: XLSX.utils.sheet_to_json(wb.Sheets['填写说明'], { header: 1 })[0],
  }
}

describe('import data template round-trip', () => {
  /** @type {{ label: string; dataSourceType: import('../domain/enums.js').DataSourceType; subType?: import('../domain/postUseRatingImport.js').PostUseRatingImportSubType; presetId: string }[]} */
  const cases = [
    {
      label: '投诉工单',
      dataSourceType: 'complaint_ticket',
      subType: undefined,
      presetId: MOBILE_CLOUD_TICKET_PRESET.id,
    },
    {
      label: '咨询工单',
      dataSourceType: 'consultation_ticket',
      subType: undefined,
      presetId: CONSULTATION_TICKET_PRESET.id,
    },
    {
      label: '客服部回访',
      dataSourceType: 'post_use_rating',
      subType: POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT,
      presetId: POST_USE_CUSTOMER_VISIT_PRESET.id,
    },
    {
      label: '用户调研',
      dataSourceType: 'user_survey',
      subType: undefined,
      presetId: USER_SURVEY_PRESET.id,
    },
    {
      label: '其他反馈',
      dataSourceType: 'other',
      subType: undefined,
      presetId: GENERIC_PRESET.id,
    },
  ]

  it.each(cases)('模板「$label」两 sheet 且导入可自动识别', ({ dataSourceType, subType, presetId }) => {
    const product = buildImportDataTemplate(dataSourceType, subType)
    expect(product).not.toBeNull()
    expect(product.filename).toMatch(/\.xlsx$/)

    const { sheetNames, headers, guideFirstRow } = readTemplateHeaders(product.buffer)
    // 两个 sheet：数据填写（列头）+ 填写说明
    expect(sheetNames).toEqual(['数据填写', '填写说明'])
    expect(headers.length).toBeGreaterThan(0)
    expect(guideFirstRow[0]).toBe('填写说明')

    // 关键守卫：模板列头能被 detectPreset 自动识别（与真实导入同一路径）
    const detected = detectPreset(headers, dataSourceType, { postUseRatingSubType: subType })
    expect(detected?.id).toBe(presetId)
  })

  it('无模板的导入方式返回 null/false（短信+官网双文件、满意度回访）', () => {
    expect(
      buildImportDataTemplate('post_use_rating', POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE),
    ).toBeNull()
    expect(
      hasImportDataTemplate('post_use_rating', POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK),
    ).toBe(false)
  })

  it('hasImportDataTemplate 覆盖五个可模板来源', () => {
    expect(hasImportDataTemplate('complaint_ticket')).toBe(true)
    expect(hasImportDataTemplate('consultation_ticket')).toBe(true)
    expect(hasImportDataTemplate('user_survey')).toBe(true)
    expect(hasImportDataTemplate('other')).toBe(true)
    expect(
      hasImportDataTemplate('post_use_rating', POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT),
    ).toBe(true)
  })

  it('模板列头与预设 columnMap 逐列一致（数组候选取首选；同名列去重）', () => {
    for (const preset of [
      MOBILE_CLOUD_TICKET_PRESET,
      CONSULTATION_TICKET_PRESET,
      POST_USE_CUSTOMER_VISIT_PRESET,
      USER_SURVEY_PRESET,
      GENERIC_PRESET,
    ]) {
      const seen = new Set()
      const expected = []
      for (const col of Object.values(preset.columnMap)) {
        const name = Array.isArray(col) ? col[0] : col
        if (seen.has(name)) continue
        seen.add(name)
        expected.push(name)
      }
      const dataSourceType = preset.dataSourceTypes[0]
      const subType =
        preset.id === POST_USE_CUSTOMER_VISIT_PRESET.id
          ? POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT
          : undefined
      const product = buildImportDataTemplate(dataSourceType, subType)
      const { headers } = readTemplateHeaders(product.buffer)
      expect(headers, preset.id).toEqual(expected)
    }
  })
})

describe('Import page wires the template download', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../pages/Import.jsx'), 'utf8')

  it('上传步按当前来源提供「下载模板」入口（替换旧样例 CSV）', () => {
    expect(source).toContain("from '../lib/importDataTemplate.js'")
    expect(source).toContain('hasImportDataTemplate(dataSourceType, postUseRatingSubType)')
    expect(source).toContain('downloadImportDataTemplate(dataSourceType, postUseRatingSubType)')
    expect(source).not.toContain('sample-tickets.csv')
  })
})
