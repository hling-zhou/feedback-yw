import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Import source query from other modules', () => {
  it('reads source/subType from the URL and keeps the dropdown in sync', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'Import.jsx'), 'utf8')
    expect(source).toContain("searchParams.get('source')")
    expect(source).toContain("searchParams.get('subType')")
    expect(source).toContain('DATA_SOURCE_TYPES.includes(initialSource)')
    expect(source).toContain('writeImportSourceToUrl')
  })

  it('workbench and library empty states pass the current data source', () => {
    const files = [
      '../components/FeedbackTable.jsx',
      './InsightWorkbench.jsx',
      '../components/workbench/WorkbenchSourceEmpty.jsx',
      '../components/workbench/SourcePlaceholderTab.jsx',
      './Themes.jsx',
    ]
    for (const relative of files) {
      const source = readFileSync(resolve(import.meta.dirname, relative), 'utf8')
      expect(source, relative).toContain('buildImportUrl')
    }
  })

  it('locates ticket and post-use headers by marker columns', () => {
    const importPage = readFileSync(resolve(import.meta.dirname, 'Import.jsx'), 'utf8')
    expect(importPage).toContain('PRIMARY_TICKET_ID_HEADERS[0]')
    expect(importPage).toContain('按表头列「工单展示流水号」识别表头')
    expect(importPage).toContain('官网评分类 / 选项类按「产品名」')
    expect(importPage).toContain('投诉处理-电话回访按「回访工单编号」识别表头')
    const bundle = readFileSync(
      resolve(import.meta.dirname, '../components/import/PostUseChannelBundleImport.jsx'),
      'utf8',
    )
    expect(bundle).toContain('官网评分类 / 选项类按「产品名」')
    expect(bundle).toContain('投诉处理-电话回访按「回访工单编号」识别')
    expect(bundle).not.toContain('表头在第 3 行')
  })
})
