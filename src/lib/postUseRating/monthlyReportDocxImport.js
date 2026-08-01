import JSZip from 'jszip'

export const META_KEY_POST_USE_REPORT_REVISIONS = 'post_use_report_revisions_v1'
export const META_KEY_POST_USE_REPORT_LEARNINGS = 'post_use_report_learning_v1'

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function extractText(fragment) {
  return decodeXmlEntities(
    [...String(fragment || '').matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((match) => match[1])
      .join(''),
  ).trim()
}

function extractBlocks(xml) {
  return [...String(xml || '').matchAll(/<(w:p|w:tbl)\b[\s\S]*?<\/\1>/g)].map((match) => {
    const raw = match[0]
    if (match[1] === 'w:p') {
      return {
        type: 'paragraph',
        text: extractText(raw),
      }
    }
    const rows = [...raw.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((rowMatch) =>
      [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cellMatch) => extractText(cellMatch[0])),
    )
    return {
      type: 'table',
      rows,
    }
  })
}

function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return []
  const [headers, ...dataRows] = rows
  return dataRows
    .filter((row) => row.some((cell) => String(cell || '').trim()))
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])),
    )
}

function normalizeMonthlyScoreTable(rows) {
  return rowsToObjects(rows).map((row) => ({
    productName: row['产品名'] || row['产品'] || '',
    sampleSize: Number(row['样本量'] || 0),
    avgScore: Number(row['得分'] || 0),
    callbackTenPointRate:
      row['投诉回访满意度-10分满意比'] && row['投诉回访满意度-10分满意比'] !== '/'
        ? Number(String(row['投诉回访满意度-10分满意比']).replace('%', ''))
        : null,
  }))
}

function normalizeScoreDistributionTable(rows) {
  return rowsToObjects(rows).map((row) => ({
    productName: row['产品名'] || row['产品'] || '',
    sampleSize: Number(row['样本量'] || 0),
    10: Number(row['10分'] || 0),
    9: Number(row['9分'] || 0),
    8: Number(row['8分'] || 0),
    7: Number(row['7分'] || 0),
    6: Number(row['6分'] || 0),
    5: Number(row['5分'] || 0),
    4: Number(row['4分'] || 0),
    3: Number(row['3分'] || 0),
    2: Number(row['2分'] || 0),
    1: Number(row['1分'] || 0),
  }))
}

function normalizeVisitsDetailed(rows) {
  return rowsToObjects(rows).map((row, index) => ({
    id: `visit-detail-${index + 1}`,
    userFeedbackText: row['用户反馈'] || '',
    userInfoDetail: row['用户信息'] || '',
    visitFeedbackDetail: row['回访反馈信息'] || '',
    internalEvaluationDetail: row['回访反馈信息-内部评估'] || '',
  }))
}

function stableRevisionId(reportMonth, fileName, importedAt) {
  const input = `${reportMonth}\0${fileName}\0${importedAt}`
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `report-revision-${(h >>> 0).toString(16)}`
}

function stableLearningId(section, kind) {
  return `report-learning:${section}:${kind}`
}

export async function importMonthlyReportDocx(file) {
  const buffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) {
    throw new Error('未识别到 Word 正文内容，仅支持系统导出的 .docx 模板')
  }
  const blocks = extractBlocks(xml)
  const titleBlock = blocks.find((block) => block.type === 'paragraph' && block.text)
  const title = titleBlock?.text || file.name
  const reportMonthMatch = title.match(/(\d{4})\.(\d{1,2})/)
  const reportMonth = reportMonthMatch
    ? `${reportMonthMatch[1]}-${String(reportMonthMatch[2]).padStart(2, '0')}`
    : ''

  let currentHeading = ''
  /** @type {Record<string, string[][]>} */
  const tablesByHeading = {}
  for (const block of blocks) {
    if (block.type === 'paragraph' && block.text) {
      currentHeading = block.text
      continue
    }
    if (block.type === 'table' && currentHeading) {
      tablesByHeading[currentHeading] = block.rows
    }
  }

  const monthlyScoreTable = normalizeMonthlyScoreTable(tablesByHeading['2.1 整体得分情况'] || [])
  const scoreDistributionTable = normalizeScoreDistributionTable(
    tablesByHeading['2.3 整体分布——用后即评｜投诉回访'] || [],
  )
  const visitsDetailed = normalizeVisitsDetailed(tablesByHeading['3.1 上期回访结果'] || [])
  const importedAt = new Date().toISOString()

  return {
    id: stableRevisionId(reportMonth, file.name, importedAt),
    fileName: file.name,
    title,
    reportMonth,
    importedAt,
    monthlyScoreTable,
    scoreDistributionTable,
    visitsDetailed,
    summary: {
      monthlyScoreRows: monthlyScoreTable.length,
      scoreDistributionRows: scoreDistributionTable.length,
      visitsDetailedRows: visitsDetailed.length,
    },
  }
}

function normalizeRowKey(value) {
  return String(value || '').trim()
}

function compareSectionRows(currentRows, revisedRows, keyFn, fields) {
  const currentMap = new Map((currentRows || []).map((row) => [keyFn(row), row]))
  const revisedMap = new Map((revisedRows || []).map((row) => [keyFn(row), row]))
  const keys = new Set([...currentMap.keys(), ...revisedMap.keys()].filter(Boolean))
  const added = []
  const removed = []
  const changed = []
  for (const key of keys) {
    const current = currentMap.get(key)
    const revised = revisedMap.get(key)
    if (!current && revised) {
      added.push(revised)
      continue
    }
    if (current && !revised) {
      removed.push(current)
      continue
    }
    const changedFields = fields.filter((field) => String(current?.[field] ?? '') !== String(revised?.[field] ?? ''))
    if (changedFields.length) {
      changed.push({
        key,
        current,
        revised,
        changedFields,
      })
    }
  }
  return {
    currentCount: currentRows?.length || 0,
    revisedCount: revisedRows?.length || 0,
    added,
    removed,
    changed,
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
  }
}

function learningTitleForSection(section) {
  if (section === '2.1') return '导出前复核 2.1 产品总表'
  if (section === '2.3') return '导出前复核 2.3 评分分布矩阵'
  return '导出前补齐上期回访结果明细'
}

function learningSummaryForSection(section, diff) {
  const parts = []
  if (diff.addedCount) parts.push(`新增 ${diff.addedCount} 行`)
  if (diff.removedCount) parts.push(`移除 ${diff.removedCount} 行`)
  if (diff.changedCount) parts.push(`修改 ${diff.changedCount} 行`)
  if (!parts.length) return ''
  if (section === '2.1') {
    return `修订版对产品级月报总表进行了${parts.join('、')}，说明发布前仍会人工复核样本量、得分或投诉回访满意比。`
  }
  if (section === '2.3') {
    return `修订版对评分分布矩阵进行了${parts.join('、')}，说明发布前仍会人工核查分数分桶与产品覆盖。`
  }
  return `修订版对上期回访结果进行了${parts.join('、')}，说明发布前仍会补充或修正回访证据明细。`
}

function learningRecommendationForSection(section) {
  if (section === '2.1') return '后续生成 Word 前，优先核查 2.1 产品名、样本量、得分与投诉回访满意度-10分满意比。'
  if (section === '2.3') return '后续生成 Word 前，优先核查 2.3 非10分产品覆盖与 10~1 分分布矩阵。'
  return '后续生成 Word 前，优先核查上期回访结果是否已补齐用户反馈、用户信息、回访反馈与内部评估。'
}

export function analyzeMonthlyReportRevisionLearning({ currentModel, revision }) {
  const monthlyScoreDiff = compareSectionRows(
    currentModel?.monthlyScoreTable || [],
    revision?.monthlyScoreTable || [],
    (row) => normalizeRowKey(row?.productName),
    ['sampleSize', 'avgScore', 'callbackTenPointRate'],
  )
  const scoreDistributionDiff = compareSectionRows(
    currentModel?.scoreDistributionTable || [],
    revision?.scoreDistributionTable || [],
    (row) => normalizeRowKey(row?.productName),
    ['sampleSize', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
  )
  const visitsDetailedDiff = compareSectionRows(
    currentModel?.visitsDetailed || [],
    revision?.visitsDetailed || [],
    (row) => `${normalizeRowKey(row?.userInfoDetail)}\u0001${normalizeRowKey(row?.userFeedbackText)}`,
    ['visitFeedbackDetail', 'internalEvaluationDetail'],
  )

  const sections = [
    { key: '2.1', label: '整体得分情况', diff: monthlyScoreDiff },
    { key: '2.3', label: '整体分布', diff: scoreDistributionDiff },
    { key: '3.1', label: '上期回访结果', diff: visitsDetailedDiff },
  ]
  const changedSections = sections.filter(
    (item) => item.diff.addedCount || item.diff.removedCount || item.diff.changedCount,
  )
  const learnings = changedSections.map((item) => ({
    id: stableLearningId(item.key, 'review'),
    section: item.key,
    kind: 'review',
    title: learningTitleForSection(item.key),
    summary: learningSummaryForSection(item.key, item.diff),
    recommendation: learningRecommendationForSection(item.key),
    reportMonth: revision?.reportMonth || '',
    sourceRevisionId: revision?.id || '',
    createdAt: new Date().toISOString(),
  }))

  return {
    comparison: {
      sameReportMonth:
        !revision?.reportMonth || !currentModel?.reportMonth || revision.reportMonth === currentModel.reportMonth,
      differenceCount: changedSections.reduce(
        (sum, item) => sum + item.diff.addedCount + item.diff.removedCount + item.diff.changedCount,
        0,
      ),
      changedSections,
      monthlyScoreDiff,
      scoreDistributionDiff,
      visitsDetailedDiff,
    },
    learnings,
  }
}

export function normalizeMonthlyReportRevisions(raw) {
  if (!raw || typeof raw !== 'object') return []
  const list = raw.revisions
  return Array.isArray(list) ? list : []
}

export function normalizeMonthlyReportLearnings(raw) {
  if (!raw || typeof raw !== 'object') return []
  const list = raw.learnings
  return Array.isArray(list) ? list : []
}

export async function loadMonthlyReportRevisions(adapter) {
  return normalizeMonthlyReportRevisions(await adapter.getMeta(META_KEY_POST_USE_REPORT_REVISIONS))
}

export async function loadMonthlyReportLearnings(adapter) {
  return normalizeMonthlyReportLearnings(await adapter.getMeta(META_KEY_POST_USE_REPORT_LEARNINGS))
}

export async function saveMonthlyReportRevisions(adapter, revisions) {
  await adapter.putMeta(META_KEY_POST_USE_REPORT_REVISIONS, {
    version: 1,
    updatedAt: new Date().toISOString(),
    revisions,
  })
}

export async function saveMonthlyReportLearnings(adapter, learnings) {
  await adapter.putMeta(META_KEY_POST_USE_REPORT_LEARNINGS, {
    version: 1,
    updatedAt: new Date().toISOString(),
    learnings,
  })
}

export async function appendMonthlyReportRevision(adapter, revision) {
  const existing = await loadMonthlyReportRevisions(adapter)
  const next = [
    revision,
    ...existing.filter((item) => item.id !== revision.id),
  ]
  await saveMonthlyReportRevisions(adapter, next)
  return next
}

export async function upsertMonthlyReportLearnings(adapter, learningEntries) {
  const existing = await loadMonthlyReportLearnings(adapter)
  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const entry of learningEntries || []) {
    const prev = byId.get(entry.id)
    byId.set(entry.id, {
      ...prev,
      ...entry,
      firstSeenAt: prev?.firstSeenAt || entry.createdAt,
      lastSeenAt: entry.createdAt,
      hitCount: Number(prev?.hitCount || 0) + 1,
    })
  }
  const next = [...byId.values()].sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
  await saveMonthlyReportLearnings(adapter, next)
  return next
}
