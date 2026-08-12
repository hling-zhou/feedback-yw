/**
 * 用后即评月报 docx 导出（表格为主；图表后置嵌入）
 */
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  WidthType,
  BorderStyle,
} from 'docx'

/**
 * @param {string} text
 * @param {number} [width]
 */
function cell(text, width = 2400) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    },
    children: [
      new Paragraph({
        children: [new TextRun({ text: String(text ?? ''), size: 18 })],
      }),
    ],
  })
}

/**
 * @param {string[]} headers
 * @param {string[][]} rows
 */
function simpleTable(headers, rows) {
  const colW = Math.floor(9000 / Math.max(headers.length, 1))
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: headers.map((h) => cell(h, colW)),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((v) => cell(v, colW)),
          }),
      ),
    ],
  })
}

/**
 * @param {import('./monthlyReportPreview.js').MonthlyReportPreviewModel} model
 * @returns {Promise<Blob>}
 */
export async function buildMonthlyReportDocxBlob(model) {
  const children = [
    new Paragraph({
      text: model.title,
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: model.overview.note || '',
          italics: true,
          size: 18,
          color: '666666',
        }),
      ],
    }),
    new Paragraph({ text: '一、对外概述', heading: HeadingLevel.HEADING_2 }),
    simpleTable(
      ['指标', '数值'],
      [
        ['云网产品数', String(model.overview.productCount)],
        ['云网样本量', String(model.overview.totalSample)],
        ['云网均分', String(model.overview.avgScore)],
        ['9分以下产品数', `${model.overview.belowNineCount}（${model.overview.belowNineRatio}%）`],
        ['公司均分', String(model.overview.companyAvg)],
        ['公司样本量', String(model.overview.companySample)],
      ],
    ),
    new Paragraph({ text: '二、投诉回访不达标（n≥10）', heading: HeadingLevel.HEADING_2 }),
  ]

  const notQ = model.satisfaction?.notQualified || []
  if (notQ.length) {
    children.push(
      simpleTable(
        ['产品', '样本量', '满意度%'],
        notQ.map((p) => [p.productName, String(p.sampleSize), String(p.rate)]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '无（或仅有小样本参考项）' }))
  }

  children.push(
    new Paragraph({
      text: `三、客服回访（${model.visitMonth}）`,
      heading: HeadingLevel.HEADING_2,
    }),
  )
  const visits = model.visits || []
  if (visits.length) {
    children.push(
      simpleTable(
        ['产品', '摘要', '结论'],
        visits.map((v) => [
          v.productName || '',
          v.feedbackSummary || '',
          v.internalConclusion || '',
        ]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '本月暂无客服回访记录' }))
  }

  const reasons = model.reasons || []
  children.push(new Paragraph({ text: '四、选项类/低分原因 Top', heading: HeadingLevel.HEADING_2 }))
  if (reasons.length) {
    children.push(
      simpleTable(
        ['原因', '次数'],
        reasons.slice(0, 20).map((r) => [r.reason, String(r.count)]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '暂无原因聚合（需导入含选项类的双文件）' }))
  }

  children.push(new Paragraph({ text: '五、举措摘要', heading: HeadingLevel.HEADING_2 }))
  const proposed = model.actionsProposed || []
  const closed = model.actionsClosed || []
  children.push(
    new Paragraph({
      text: `本月提出 ${proposed.length} 条，本月关闭 ${closed.length} 条（详见举措与进展）。`,
    }),
  )

  const doc = new Document({
    sections: [{ children }],
  })
  const buffer = await Packer.toBlob(doc)
  return buffer
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
export function triggerDocxDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
