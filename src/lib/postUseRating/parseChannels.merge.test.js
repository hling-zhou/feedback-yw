import { describe, expect, it } from 'vitest'
import { mergeOfficialChannelWorkbooks, mergeSmsChannelWorkbooks } from './parseChannels.js'

describe('merge channel workbooks', () => {
  it('concatenates sms rows from multiple files', () => {
    const merged = mergeSmsChannelWorkbooks([
      { sheetName: '短信渠道用后即评明细数据', headers: ['产品名称'], rows: [{ 产品名称: 'A' }], error: '' },
      { sheetName: '短信渠道用后即评明细数据', headers: ['产品名称'], rows: [{ 产品名称: 'B' }], error: '' },
    ])
    expect(merged.error).toBe('')
    expect(merged.rows).toHaveLength(2)
    expect(merged.rows.map((r) => r.产品名称)).toEqual(['A', 'B'])
  })

  it('surfaces the first sms parse error', () => {
    const merged = mergeSmsChannelWorkbooks([
      { sheetName: '', headers: [], rows: [], error: '未找到短信渠道 Sheet' },
    ])
    expect(merged.error).toBe('未找到短信渠道 Sheet')
  })

  it('concatenates official score / option / callback sheets', () => {
    const merged = mergeOfficialChannelWorkbooks([
      {
        sheetNames: ['评分类'],
        score: { headers: ['得分'], rows: [{ 得分: '10' }] },
        option: null,
        callback: { headers: ['回访'], rows: [{ 回访: '1' }] },
        scoreSheetName: '评分类',
        optionSheetName: '',
        callbackSheetName: '投诉处理-电话回访',
        error: '',
      },
      {
        sheetNames: ['评分类', '选项类'],
        score: { headers: ['得分'], rows: [{ 得分: '9' }] },
        option: { headers: ['产品名'], rows: [{ 产品名: 'EIP' }] },
        callback: null,
        scoreSheetName: '评分类',
        optionSheetName: '选项类',
        callbackSheetName: '',
        error: '',
      },
    ])
    expect(merged.error).toBe('')
    expect(merged.score?.rows).toHaveLength(2)
    expect(merged.option?.rows).toHaveLength(1)
    expect(merged.callback?.rows).toHaveLength(1)
  })
})
