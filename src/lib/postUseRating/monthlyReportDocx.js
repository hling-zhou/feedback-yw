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
  ]
  const reviewChecklist = model.reviewChecklist || []
  if (reviewChecklist.length) {
    children.push(new Paragraph({ text: '报告复核提示', heading: HeadingLevel.HEADING_2 }))
    children.push(
      new Paragraph({
        text: '以下内容来自历史修订稿沉淀的学习库，会在本次 Word 生成时一并提示复核重点。',
      }),
    )
    children.push(
      simpleTable(
        ['章节', '复核经验', '本次建议', '命中次数'],
        reviewChecklist.map((item) => [
          item.sectionLabel || item.section || '',
          item.title || '',
          item.recommendation || '',
          String(item.hitCount || 0),
        ]),
      ),
    )
  }
  children.push(
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
    new Paragraph({ text: '1.2 投诉回访满意度', heading: HeadingLevel.HEADING_3 }),
  )
  const quality = model.onlineModel?.quality
  if (quality?.counts) {
    children.splice(
      children.length - 1,
      0,
      new Paragraph({
        text: `数据质量：原始 ${quality.counts.raw || 0} 行，有效评分 ${quality.counts.validScored || 0} 条，分析范围内 ${quality.counts.analysisScoped || 0} 条，范围外 ${quality.counts.outOfScope || 0} 条。目录版本 ${quality.versions?.catalog || '—'}，分析规则 ${quality.versions?.analysisRule || model.onlineModel?.ruleVersion || '—'}。`,
      }),
    )
  }

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

  const productExperience = model.productExperience || []
  children.push(new Paragraph({ text: '二、线上综合分析', heading: HeadingLevel.HEADING_2 }))
  children.push(new Paragraph({ text: '2.1 整体得分情况', heading: HeadingLevel.HEADING_3 }))
  const monthlyScoreTable = model.monthlyScoreTable || []
  if (monthlyScoreTable.length) {
    children.push(
      simpleTable(
        ['产品名', '样本量', '得分', '投诉回访满意度-10分满意比'],
        monthlyScoreTable.map((item) => [
          item.productName,
          String(item.sampleSize),
          String(item.avgScore),
          item.callbackTenPointRate == null ? '/' : `${item.callbackTenPointRate}%`,
        ]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '本月暂无月报口径产品总表。' }))
  }

  const sceneJourneys = model.sceneJourneys || []
  children.push(new Paragraph({ text: '2.2 整体趋势', heading: HeadingLevel.HEADING_3 }))
  if (productExperience.length) {
    children.push(
      simpleTable(
        ['产品', '体验状态', '样本量', '均分', '非10分', '回访证据', '判定依据'],
        productExperience.map((item) => [
          item.productName,
          item.state,
          String(item.sampleSize),
          String(item.avgScore),
          String(item.nonTenCount),
          String(item.visitEvidenceCount || 0),
          item.explanation,
        ]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '本月暂无产品体验分析。' }))
  }
  children.push(new Paragraph({ text: '2.2.1 评价触发场景与用户旅程', heading: HeadingLevel.HEADING_3 }))
  if (sceneJourneys.length) {
    children.push(
      simpleTable(
        ['产品', '评价触发场景', '用户旅程', '样本量', '均分', '非10分'],
        sceneJourneys.slice(0, 30).map((item) => [
          item.productName,
          item.originalScene,
          item.journey,
          String(item.sampleSize),
          String(item.avgScore),
          String(item.nonTenCount),
        ]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '本月暂无场景与旅程分析。' }))
  }

  const needs = model.needs || []
  children.push(new Paragraph({ text: '2.2.2 用户需求改善优先级', heading: HeadingLevel.HEADING_3 }))
  if (needs.length) {
    children.push(
      simpleTable(
        ['改善优先级', '产品', '用户需求', '反馈数', '客户数', '回访证据', '改善优先分'],
        needs.slice(0, 20).map((item) => [
          item.priority,
          item.productName,
          item.need,
          String(item.count),
          String(item.customerCount),
          String(item.visitEvidenceCount || 0),
          String(item.priorityScore),
        ]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '本月暂无可提取的用户需求。' }))
  }

  const customers = (model.customers || []).filter((item) => item.highFrequency || item.visitEvidenceCount)
  children.push(new Paragraph({ text: '2.2.3 客户洞察与回访证据', heading: HeadingLevel.HEADING_3 }))
  if (customers.length) {
    children.push(
      simpleTable(
        ['客户', '涉及产品', '非10分次数', '均分', '最近原话', '回访证据', '回访结论'],
        customers.slice(0, 20).map((item) => [
          item.customerName,
          (item.products || []).join('、'),
          String(item.nonTenCount),
          item.avgScore == null ? '—' : String(item.avgScore),
          item.latestQuote || '',
          String(item.visitEvidenceCount || 0),
          item.visitConclusion || '',
        ]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '本月未识别到需关注客户或客服部回访证据。' }))
  }

  const issueChanges = model.issueChanges || []
  children.push(new Paragraph({ text: '2.2.4 问题变化', heading: HeadingLevel.HEADING_3 }))
  if (issueChanges.length) {
    children.push(
      simpleTable(
        ['变化', '产品', '问题/需求', '上期', '本期'],
        issueChanges.slice(0, 30).map((item) => [
          item.change,
          item.productName,
          item.issue,
          String(item.previousCount),
          String(item.currentCount),
        ]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '至少需要两个数据月份才能判断问题变化。' }))
  }

  const scoreDistributionTable = model.scoreDistributionTable || []
  children.push(new Paragraph({ text: '2.3 整体分布——用后即评｜投诉回访', heading: HeadingLevel.HEADING_3 }))
  if (scoreDistributionTable.length) {
    children.push(
      simpleTable(
        ['产品名', '样本量', '10分', '9分', '8分', '7分', '6分', '5分', '4分', '3分', '2分', '1分'],
        scoreDistributionTable.map((item) => [
          item.productName,
          String(item.sampleSize || 0),
          String(item[10] || 0),
          String(item[9] || 0),
          String(item[8] || 0),
          String(item[7] || 0),
          String(item[6] || 0),
          String(item[5] || 0),
          String(item[4] || 0),
          String(item[3] || 0),
          String(item[2] || 0),
          String(item[1] || 0),
        ]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '当前范围内暂无需要展开分布的产品。' }))
  }

  children.push(
    new Paragraph({
      text: `三、客服部回访（数据月份 ${model.visitMonth}）`,
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
    children.push(new Paragraph({ text: '本月暂无客服部回访记录' }))
  }
  const visitsDetailed = model.visitsDetailed || []
  children.push(new Paragraph({ text: '3.1 上期回访结果', heading: HeadingLevel.HEADING_3 }))
  if (visitsDetailed.length) {
    children.push(
      simpleTable(
        ['客户名称', '客户编码', '回访反馈信息', '回访反馈信息-内部评估'],
        visitsDetailed.map((item) => [
          item.customerName || '—',
          item.customerCode || '—',
          item.visitFeedbackDetail || '—',
          item.internalEvaluationDetail || '—',
        ]),
      ),
    )
  } else {
    children.push(new Paragraph({ text: '本月暂无完整回访明细' }))
  }

  const reasons = model.reasons || []
  children.push(new Paragraph({ text: '四、原因证据', heading: HeadingLevel.HEADING_2 }))
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

  children.push(new Paragraph({ text: '五、举措与效果验证', heading: HeadingLevel.HEADING_2 }))
  const proposed = model.actionsProposed || []
  const closed = model.actionsClosed || []
  children.push(
    new Paragraph({
      text: `本月提出 ${proposed.length} 条，本月关闭 ${closed.length} 条（详见举措与进展）。`,
    }),
  )
  const mappings = model.actionMappings || []
  if (mappings.length) {
    children.push(
      simpleTable(
        ['产品', '洞察主题', '举措', '证据数', '效果'],
        mappings.map((item) => [
          item.productName || '',
          item.insightTheme || '',
          item.content || '',
          String(item.evidenceCount || 0),
          item.recovery || '',
        ]),
      ),
    )
  }
  const notRecovered = model.completedButNotRecovered || []
  if (notRecovered.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `已完成但体验未恢复：${notRecovered.map((item) => item.content).join('；')}`, color: 'C00000', bold: true })],
      }),
    )
  }

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
