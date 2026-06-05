import { InboxOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Modal,
  Space,
  Table,
  Typography,
  Upload,
  message,
} from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { ImportProgressAlert } from '../TaggingProgressAlert.jsx'
import InsightMonthPicker from '../InsightMonthPicker.jsx'
import InsightPeriodPicker from '../InsightPeriodPicker.jsx'
import { useInsights } from '../../context/InsightsContext.jsx'
import { useSharedBackgroundTaskBlock } from '../../hooks/useSharedBackgroundTaskBlock.js'
import { readBackgroundTaskErrorMessage } from '../../lib/backgroundTaskClient.js'
import { detectPreset, SATISFACTION_CALLBACK_PRESET } from '../../lib/columnPresets.js'
import { importFollowUpSatisfaction } from '../../lib/followUpSatisfactionClient.js'
import {
  downloadUnmatchedFollowUpCsv,
  processFollowUpSatisfactionImportRows,
  summarizeFollowUpImportResult,
} from '../../lib/followUpSatisfactionImport.js'
import { normalizeImportMonth, validateImportFile, validateRowCount } from '../../lib/importUtils.js'
import { parseUploadFile } from '../../lib/parseFile.js'
import { fetchAllRecordPages } from '../../lib/recordLoader.js'
import { persistRecordUpdates, isApiStorageAdapter } from '../../storage/feedbackStore.js'
import { markPeriodSnapshotsStale } from '../../snapshots/snapshotService.js'

const SESSION_LABEL = '满意度回访导入'

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

/**
 * @param {import('../../lib/followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary | null} summary
 */
function formatSummaryDescription(summary) {
  if (!summary) return null
  return (
    <>
      成功补全 <strong>{summary.appliedRowCount}</strong> 行，更新工单{' '}
      <strong>{summary.updatedRecordCount}</strong> 条；未匹配{' '}
      <strong>{summary.unmatched.length}</strong> 行；跳过（回访未成功）{' '}
      <strong>{summary.skippedNotSuccessful}</strong> 行
      {(summary.skippedInvalidScore ?? 0) > 0 && (
        <>
          ；跳过（成功无有效评分）{' '}
          <strong>{summary.skippedInvalidScore}</strong> 行
        </>
      )}
      {summary.outOfPeriodCount > 0 && (
        <>
          ；周期外补全 <strong>{summary.outOfPeriodCount}</strong> 条
        </>
      )}
      {summary.overwrittenCount > 0 && (
        <>
          ；覆盖旧回访 <strong>{summary.overwrittenCount}</strong> 条
        </>
      )}
    </>
  )
}

export default function FollowUpSatisfactionImportPanel() {
  const {
    adapter,
    storageReady,
    periods,
    currentPeriodId,
    importSession,
    prepareSharedBackgroundTask,
    beginImportSession,
    setImportSessionProgress,
    endImportSession,
    syncSharedDataFromServer,
  } = useInsights()
  const { importBlocked, importBlockedTip } = useSharedBackgroundTaskBlock()

  const [insightPeriodId, setInsightPeriodId] = useState(currentPeriodId)
  const [importMonth, setImportMonth] = useState(currentMonth)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [fileName, setFileName] = useState('')
  /** @type {[Record<string, string>[], Function]} */
  const [rows, setRows] = useState([])
  /** @type {[import('../../lib/followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary | null, Function]} */
  const [preview, setPreview] = useState(null)
  /** @type {[import('../../lib/followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary | null, Function]} */
  const [applySummary, setApplySummary] = useState(null)
  const [parseError, setParseError] = useState('')

  const followUpImportActive = importSession.active && importSession.batchName === SESSION_LABEL
  const blocked = importBlocked || importing || parsing

  const period = useMemo(
    () => periods.find((p) => p.id === insightPeriodId) ?? null,
    [periods, insightPeriodId],
  )

  const importMonthNormalized = useMemo(() => normalizeImportMonth(importMonth), [importMonth])

  const runDryRun = useCallback(
    async (parsedRows) => {
      const payload = {
        importMonth: importMonthNormalized,
        insightPeriodId: insightPeriodId || undefined,
        rows: parsedRows,
        dryRun: true,
      }

      if (isApiStorageAdapter(adapter)) {
        return importFollowUpSatisfaction(payload)
      }

      await adapter.init()
      const { records } = await fetchAllRecordPages(adapter)
      const tickets = records.filter(
        (r) =>
          r.dataSourceType === 'complaint_ticket' ||
          r.dataSourceType === 'consultation_ticket',
      )
      return {
        ok: true,
        dryRun: true,
        ...summarizeFollowUpImportResult(
          processFollowUpSatisfactionImportRows(parsedRows, tickets, {
            importMonth: importMonthNormalized,
            period,
          }),
        ),
      }
    },
    [adapter, importMonthNormalized, insightPeriodId, period],
  )

  const handleUpload = useCallback(
    async (file) => {
      if (blocked) {
        message.warning(importBlockedTip || '当前无法上传')
        return Upload.LIST_IGNORE
      }
      if (!importMonthNormalized) {
        message.error('请先选择有效的回访月份')
        return Upload.LIST_IGNORE
      }

      const fileCheck = validateImportFile(file)
      if (!fileCheck.ok) {
        message.error(fileCheck.message)
        return Upload.LIST_IGNORE
      }

      setParsing(true)
      setParseError('')
      setPreview(null)
      setApplySummary(null)
      setFileName(file.name)

      try {
        const { headers, rows: parsedRows } = await parseUploadFile(file)
        const rowCountCheck = validateRowCount(parsedRows.length)
        if (!rowCountCheck.ok) {
          setParseError(rowCountCheck.message)
          message.error(rowCountCheck.message)
          return Upload.LIST_IGNORE
        }

        const preset = detectPreset(headers)
        if (!preset || preset.id !== SATISFACTION_CALLBACK_PRESET.id) {
          const msg = '表头需包含「回访工单编号」与「原工单编号」（满意度回访记录格式）'
          setParseError(msg)
          message.error(msg)
          return Upload.LIST_IGNORE
        }

        setRows(parsedRows)
        const dryRunResult = await runDryRun(parsedRows)
        setPreview(dryRunResult)
        message.success(`解析 ${parsedRows.length} 行，预览完成`)
      } catch (err) {
        const text = err instanceof Error ? err.message : '解析文件失败'
        setParseError(text)
        message.error(text)
      } finally {
        setParsing(false)
      }

      return Upload.LIST_IGNORE
    },
    [blocked, importBlockedTip, importMonthNormalized, runDryRun],
  )

  const executeImport = useCallback(async () => {
    if (!rows.length || !importMonthNormalized || !storageReady) return

    setImporting(true)
    setApplySummary(null)
    let sessionStarted = false

    try {
      await prepareSharedBackgroundTask('import', {
        progress: '正在导入满意度回访…',
        meta: { importKind: 'followUp', importMonth: importMonthNormalized },
      })
      beginImportSession({
        batchName: SESSION_LABEL,
        progress: '正在导入满意度回访…',
        dataMonth: importMonthNormalized,
        kind: 'analysis',
      })
      sessionStarted = true
      setImportSessionProgress('正在匹配并写入回访数据…')

      const payload = {
        importMonth: importMonthNormalized,
        insightPeriodId: insightPeriodId || undefined,
        importBatchId: `follow-up-${importMonthNormalized}-${Date.now()}`,
        rows,
        dryRun: false,
      }

      /** @type {import('../../lib/followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary} */
      let summary

      if (isApiStorageAdapter(adapter)) {
        summary = await importFollowUpSatisfaction(payload)
      } else {
        await adapter.init()
        const { records } = await fetchAllRecordPages(adapter)
        const tickets = records.filter(
          (r) =>
            r.dataSourceType === 'complaint_ticket' ||
            r.dataSourceType === 'consultation_ticket',
        )
        const result = processFollowUpSatisfactionImportRows(rows, tickets, {
          importMonth: importMonthNormalized,
          importBatchId: payload.importBatchId,
          period,
        })
        if (result.updatedRecords.length) {
          setImportSessionProgress(`正在保存（0/${result.updatedRecords.length}）…`)
          await persistRecordUpdates(adapter, result.updatedRecords, {
            onProgress: (uploaded, total) => {
              setImportSessionProgress(`正在保存（${uploaded}/${total}）…`)
            },
          })
        }
        summary = { ok: true, dryRun: false, ...summarizeFollowUpImportResult(result) }
        if (summary.updatedRecordCount > 0 && insightPeriodId) {
          await markPeriodSnapshotsStale(adapter, insightPeriodId)
        }
      }

      if (summary.updatedRecordCount > 0) {
        setImportSessionProgress('正在同步数据…')
        await syncSharedDataFromServer({ notify: false })
      }

      setApplySummary(summary)
      if (summary.updatedRecordCount === 0) {
        message.warning('没有工单被更新，请检查未匹配清单')
      } else {
        message.success(`已补全 ${summary.updatedRecordCount} 条工单的回访满意度`)
      }
    } catch (err) {
      message.error(readBackgroundTaskErrorMessage(err) || err.message || '导入失败')
    } finally {
      if (sessionStarted) endImportSession()
      setImporting(false)
    }
  }, [
    adapter,
    beginImportSession,
    endImportSession,
    importMonthNormalized,
    insightPeriodId,
    period,
    prepareSharedBackgroundTask,
    rows,
    setImportSessionProgress,
    storageReady,
    syncSharedDataFromServer,
  ])

  const handleConfirmImport = useCallback(() => {
    if (!preview?.appliedRowCount && !preview?.unmatched.length) {
      message.warning('没有可导入的数据行')
      return
    }
    Modal.confirm({
      title: '确认导入满意度回访？',
      content: (
        <>
          将按<strong>原工单号</strong>匹配投诉/咨询工单并写入回访满意度；同回访工单号重复导入将覆盖更新。
          <br />
          预计写入 <strong>{preview?.appliedRowCount ?? 0}</strong> 行，更新工单{' '}
          <strong>{preview?.updatedRecordCount ?? 0}</strong> 条。
        </>
      ),
      okText: '确认导入',
      cancelText: '取消',
      onOk: executeImport,
    })
  }, [executeImport, preview])

  const previewTableData = useMemo(() => {
    if (!preview) return []
    return [
      ...preview.unmatched.map((item, index) => ({
        key: `unmatched-${index}`,
        rowIndex: item.rowIndex,
        originalTicketId: item.originalTicketId || '—',
        followUpTicketId: item.followUpTicketId || '—',
        status: '未匹配',
        detail: item.reason,
      })),
      ...preview.warnings.map((item, index) => ({
        key: `warn-${index}`,
        rowIndex: item.rowIndex,
        originalTicketId: '—',
        followUpTicketId: '—',
        status: '警告',
        detail: item.message,
      })),
    ]
  }, [preview])

  return (
    <div>
      <Card className="page-section">
        <Typography.Title level={5} className="!mb-4">
          洞察周期与回访月份
        </Typography.Title>
        <div className="page-grid-2">
          <div>
            <Typography.Text strong className="mb-1 block text-xs">
              洞察周期（用于周期外警告）
            </Typography.Text>
            <InsightPeriodPicker
              className="w-full"
              value={insightPeriodId}
              onChange={(id) => setInsightPeriodId(id || currentPeriodId)}
              showHint={false}
            />
          </div>
          <div>
            <Typography.Text strong className="mb-1 block text-xs">
              回访月份
            </Typography.Text>
            <InsightMonthPicker className="w-full" value={importMonth} onChange={setImportMonth} />
            <Typography.Text type="secondary" className="mt-2 block text-xs">
              写入工单的 importMonth，用于回访满意度趋势分析。
            </Typography.Text>
          </div>
        </div>
      </Card>

      {importBlocked && !followUpImportActive && (
        <Alert
          className="page-section-sm"
          type="warning"
          showIcon
          title="暂无法导入"
          description={importBlockedTip}
        />
      )}

      {followUpImportActive && (
        <ImportProgressAlert progress={importSession.progress} dataMonth={importSession.dataMonth} />
      )}

      <Card className="page-section">
        <Typography.Paragraph type="secondary" className="!mb-3 text-xs">
          上传满意度回访 Excel/CSV，按原工单号补全投诉/咨询工单的回访满意度；与工单 Excel
          导入、分析结果导入、批量重新打标互斥。
        </Typography.Paragraph>
        <Upload.Dragger
          accept=".csv,.xlsx,.xls"
          showUploadList={false}
          disabled={blocked || followUpImportActive || !importMonthNormalized}
          beforeUpload={handleUpload}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">
            {parsing ? '正在解析…' : '点击或拖拽上传满意度回访记录'}
          </p>
          <p className="ant-upload-hint">需含「回访工单编号」「原工单编号」等列</p>
        </Upload.Dragger>

        {parseError && (
          <Alert className="!mt-4" type="error" showIcon title="无法解析" description={parseError} />
        )}

        {fileName && !parseError && (
          <Typography.Text type="secondary" className="!mt-4 block text-xs">
            文件：{fileName} · {rows.length} 行
          </Typography.Text>
        )}

        {preview && (
          <div className="!mt-4 space-y-3">
            <Alert
              type={preview.appliedRowCount > 0 ? 'success' : 'warning'}
              showIcon
              title="预览结果"
              description={formatSummaryDescription(preview)}
            />

            {previewTableData.length > 0 && (
              <Table
                size="small"
                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                dataSource={previewTableData}
                columns={[
                  { title: '行号', dataIndex: 'rowIndex', width: 64 },
                  { title: '原工单号', dataIndex: 'originalTicketId', width: 140 },
                  { title: '回访工单号', dataIndex: 'followUpTicketId', width: 140 },
                  { title: '状态', dataIndex: 'status', width: 72 },
                  { title: '说明', dataIndex: 'detail', ellipsis: true },
                ]}
              />
            )}

            <Space wrap>
              <Button
                type="primary"
                disabled={
                  blocked ||
                  followUpImportActive ||
                  !storageReady ||
                  importing ||
                  preview.appliedRowCount === 0
                }
                loading={importing}
                onClick={handleConfirmImport}
              >
                确认导入
              </Button>
              {preview.unmatched.length > 0 && (
                <Button onClick={() => downloadUnmatchedFollowUpCsv(preview.unmatched)}>
                  下载未匹配 CSV
                </Button>
              )}
            </Space>
          </div>
        )}

        {applySummary && (
          <Alert
            className="!mt-4"
            type={applySummary.updatedRecordCount > 0 ? 'success' : 'warning'}
            showIcon
            title="导入完成"
            description={formatSummaryDescription(applySummary)}
            action={
              applySummary.unmatched.length > 0 ? (
                <Button size="small" onClick={() => downloadUnmatchedFollowUpCsv(applySummary.unmatched)}>
                  下载未匹配
                </Button>
              ) : undefined
            }
          />
        )}
      </Card>
    </div>
  )
}
