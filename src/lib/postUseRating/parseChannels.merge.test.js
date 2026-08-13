import { describe, expect, it } from 'vitest'
import { mergeOfficialChannelWorkbooks, mergeSmsChannelWorkbooks, normalizeOptionRows } from './parseChannels.js'

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

describe('normalizeOptionRows', () => {
  it('parses rating-question answers as scores and keeps later columns as reasons', () => {
    const rows = normalizeOptionRows([
      {
        产品名: '弹性公网IP',
        集团客户名称: '中国铁塔',
        集团客户编码: 'C1',
        填答时间: '2026-06-01 10:00:00.0',
        题型: '评分题',
        客户回答: '5',
        客户回答_2: '界面不好用',
        客户回答_3: '缺乏操作指引',
        列25: '建议增加说明',
        问卷名: '新版退订页问卷',
        触点页面名称: 'newProductCancelPage',
        一级场景: '退订',
      },
      {
        产品名: '云主机 ECS',
        集团客户名称: '普通客户',
        题型: '多选题',
        客户回答: '业务使用完毕',
        客户回答_2: '无/不涉及',
      },
    ])
    expect(rows[0]).toMatchObject({
      channel: 'option',
      productName: '弹性公网IP',
      score: 5,
      customerName: '中国铁塔',
      surveyName: '新版退订页问卷',
      touchpointPageName: 'newProductCancelPage',
      rawComment: '建议增加说明',
      feedbackReasonTexts: ['界面不好用', '缺乏操作指引', '建议增加说明'],
    })
    expect(rows[1]).toMatchObject({
      productName: '云主机 ECS',
      feedbackReasonTexts: ['业务使用完毕', '无/不涉及'],
    })
    expect(Number.isFinite(rows[1].score)).toBe(false)
  })
})
