import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Modal, Table, Tag, Typography, Upload, message } from 'antd'
import { useCallback, useState } from 'react'
import { ImportProgressAlert } from './TaggingProgressAlert.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { getImportColumns } from '../domain/fieldRegistry.js'
import { useSharedBackgroundTaskBlock } from '../hooks/useSharedBackgroundTaskBlock.js'
import { parseAndValidateImportAnalysisSheet } from '../lib/importAnalysis.js'
import {
  downloadImportAnalysisTemplate,
  getImportAnalysisTemplateHeaders,
} from '../lib/importAnalysisTemplate.js'
import { validateImportFile, validateRowCount } from '../lib/importUtils.js'
import { parseUploadFile } from '../lib/parseFile.js'

const TEMPLATE_COLUMN_COUNT = getImportAnalysisTemplateHeaders().length

const columnRows = getImportColumns().map((field, index) => ({
  key: field.fieldKey,
  order: index + 1,
  name: field.displayName,
  required: field.importRequired !== false && field.fieldKey !== 'actionSchedule',
}))

/**
 * @param {{
 *   inModal?: boolean
 *   onImportComplete?: (summary: {
 *     appliedRowCount: number
 *     skippedRowCount: number
 *     updatedRecordCount: number
 *     skippedUnknownTicketIds: string[]
 *   }) => void
 * }} props
 */
export default function ImportAnalysisPanel({ inModal = false, onImportComplete }) {
  const {
    importAnalysisResults,
    storageReady,
    reprocessing,
    importSession,
  } = useInsights()
  const { importBlocked, importBlockedTip, remoteBannerText, retagBlockedTip } =
    useSharedBackgroundTaskBlock()

  const [parsing, setParsing] = useState(false)
  const [applying, setApplying] = useState(false)
  /** @type {[import('../lib/importAnalysis.js').ImportAnalysisValidationResult | null, Function]} */
  const [validation, setValidation] = useState(null)
  /** @type {[{
   *   appliedRowCount: number
   *   skippedRowCount: number
   *   updatedRecordCount: number
   *   skippedUnknownTicketIds: string[]
   * } | null, Function]} */
  const [applySummary, setApplySummary] = useState(null)
  const [fileName, setFileName] = useState('')
  const [applyProgress, setApplyProgress] = useState('')

  const analysisImportActive = importSession.active && importSession.kind === 'analysis'
  const blocked = importBlocked || reprocessing
  const blockedTip = reprocessing ? retagBlockedTip : importBlockedTip

  const handleUpload = useCallback(async (file) => {
    if (blocked) {
      message.warning(blockedTip || '当前无法上传')
      return Upload.LIST_IGNORE
    }

    const fileCheck = validateImportFile(file)
    if (!fileCheck.ok) {
      message.error(fileCheck.message)
      return Upload.LIST_IGNORE
    }

    setParsing(true)
    setValidation(null)
    setApplySummary(null)
    setFileName(file.name)

    try {
      const { headers, rows } = await parseUploadFile(file)
      const rowCountCheck = validateRowCount(rows.length)
      if (!rowCountCheck.ok) {
        message.error(rowCountCheck.message)
        setValidation({
          ok: false,
          fileError: rowCountCheck.message,
          headerMatch: {
            ok: false,
            requiredHeaders: [],
            missingHeaders: [],
            matchedHeaders: [],
            extraHeaders: [],
          },
          validRows: [],
          rowErrors: [],
        })
        return Upload.LIST_IGNORE
      }

      const result = parseAndValidateImportAnalysisSheet({ headers, rows })
      setValidation(result)

      if (result.fileError) {
        message.error(result.fileError)
      } else if (result.ok) {
        message.success(`校验通过：${result.validRows.length} 行可导入`)
      } else {
        message.warning(
          `校验完成：${result.validRows.length} 行通过，${result.rowErrors.length} 处错误`,
        )
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : '解析文件失败'
      message.error(text)
      setValidation({
        ok: false,
        fileError: text,
        headerMatch: {
          ok: false,
          requiredHeaders: [],
          missingHeaders: [],
          matchedHeaders: [],
          extraHeaders: [],
        },
        validRows: [],
        rowErrors: [],
      })
    } finally {
      setParsing(false)
    }

    return Upload.LIST_IGNORE
  }, [blocked, blockedTip])

  const handleApplyImport = useCallback(() => {
    if (!validation?.validRows.length || blocked) return

    Modal.confirm({
      title: '确认导入分析结果？',
      content: (
        <>
          将按<strong> 工单号 </strong>
          覆盖库内已有记录的分析字段；空单元格也会清空线上值。未匹配的工单号将跳过。
          <br />
          本次可写入 <strong>{validation.validRows.length}</strong> 行。
        </>
      ),
      okText: '确认导入',
      cancelText: '取消',
      onOk: async () => {
        setApplying(true)
        setApplySummary(null)
        setApplyProgress('准备导入…')
        try {
          const summary = await importAnalysisResults(validation.validRows, setApplyProgress)
          setApplySummary(summary)
          if (summary.updatedRecordCount === 0) {
            message.warning(
              summary.skippedUnknownTicketIds.length
                ? `未匹配任何库内工单（${summary.skippedUnknownTicketIds.length} 个工单号）`
                : '没有记录被更新',
            )
          } else {
            message.success(
              `已更新 ${summary.updatedRecordCount} 条记录` +
                (summary.skippedRowCount
                  ? `，跳过未匹配 ${summary.skippedRowCount} 行`
                  : ''),
            )
            onImportComplete?.(summary)
          }
        } catch (err) {
          message.error(err instanceof Error ? err.message : '导入失败')
        } finally {
          setApplying(false)
          setApplyProgress('')
        }
      },
    })
  }, [blocked, importAnalysisResults, onImportComplete, validation])

  const canApply =
    storageReady &&
    !blocked &&
    !parsing &&
    !applying &&
    validation &&
    !validation.fileError &&
    validation.validRows.length > 0

  const uploadBlock = (
    <>
      {!inModal && (
        <Typography.Paragraph type="secondary" className="!mb-3 text-xs">
          上传后校验表头与各行必填/枚举；校验通过的行可写入库内已有工单。导入期间与工单 Excel
          导入、批量重新打标互斥。
        </Typography.Paragraph>
      )}
      <Upload.Dragger
        accept=".csv,.xlsx,.xls"
        showUploadList={false}
        disabled={parsing || applying || blocked || analysisImportActive}
        beforeUpload={handleUpload}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          {parsing ? '正在解析…' : '点击或拖拽上传分析结果 Excel / CSV'}
        </p>
        <p className="ant-upload-hint">表头需与导出 v2 一致</p>
      </Upload.Dragger>

      {validation && (
        <div className="!mt-4 space-y-3">
          {fileName && (
            <Typography.Text type="secondary" className="text-xs">
              文件：{fileName}
            </Typography.Text>
          )}

          {validation.fileError && (
            <Alert type="error" showIcon title="无法导入" description={validation.fileError} />
          )}

          {!validation.fileError && (
            <Alert
              type={validation.ok ? 'success' : 'warning'}
              showIcon
              title={validation.ok ? '校验通过' : '校验发现问题'}
              description={
                <>
                  有效行 {validation.validRows.length} 条
                  {validation.rowErrors.length > 0 && (
                    <>，错误 {validation.rowErrors.length} 处</>
                  )}
                  {validation.headerMatch.extraHeaders.length > 0 && (
                    <>
                      ；已忽略多余列：
                      {validation.headerMatch.extraHeaders.join('、')}
                    </>
                  )}
                </>
              }
            />
          )}

          {validation.rowErrors.length > 0 && (
            <Table
              size="small"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              rowKey={(row) => `${row.rowIndex}-${row.displayName}`}
              dataSource={validation.rowErrors}
              columns={[
                { title: '行', dataIndex: 'rowIndex', width: 56 },
                { title: '列', dataIndex: 'displayName', width: 120 },
                { title: '说明', dataIndex: 'message' },
              ]}
            />
          )}

          {canApply && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="primary" loading={applying} onClick={handleApplyImport}>
                导入 {validation.validRows.length} 行（覆盖已有工单）
              </Button>
              {applyProgress && (
                <Typography.Text type="secondary" className="text-xs">
                  {applyProgress}
                </Typography.Text>
              )}
            </div>
          )}

          {applySummary && (
            <Alert
              type={applySummary.updatedRecordCount ? 'success' : 'info'}
              showIcon
              title="导入完成"
              description={
                <>
                  匹配并写入 {applySummary.appliedRowCount} 行，更新记录{' '}
                  {applySummary.updatedRecordCount} 条
                  {applySummary.skippedRowCount > 0 && (
                    <>；未匹配库内工单 {applySummary.skippedRowCount} 行</>
                  )}
                  {applySummary.skippedUnknownTicketIds.length > 0 && (
                    <div className="!mt-2 text-xs">
                      未匹配工单号：
                      {applySummary.skippedUnknownTicketIds.slice(0, 20).join('、')}
                      {applySummary.skippedUnknownTicketIds.length > 20 ? '…' : ''}
                    </div>
                  )}
                </>
              }
            />
          )}
        </div>
      )}
    </>
  )

  return (
    <div className={inModal ? 'space-y-3' : 'space-y-4'}>
      <Alert
        type="info"
        showIcon
        title="导入分析结果（覆盖已有工单）"
        description={
          <>
            本入口<strong>不会新增工单</strong>，仅按<strong> 工单号 </strong>
            匹配库内已有记录并覆盖分析字段；未匹配的工单号将跳过。空单元格也会覆盖线上值。
            {inModal && (
              <>
                {' '}
                导入字段记为人工来源；批量重新打标默认保留人工内容，需勾选「强制覆盖全部人工内容」才会重写。
              </>
            )}
            {!inModal && (
              <>
                {' '}
                与「数据导入」不同：后者用于首次入库原始数据列。
              </>
            )}
          </>
        }
      />

      {!inModal && (
        <Alert
          type="warning"
          showIcon
          title="请勿与工单 Excel 导入混淆"
          description="工单 Excel 用于首次入库（含受理内容、处理意见等原始列）；分析结果 Excel 列固定为导出 v2 格式，用于往返编辑后回写。"
        />
      )}

      {remoteBannerText && (
        <Alert type="info" showIcon title="后台任务" description={remoteBannerText} />
      )}

      {blocked && !analysisImportActive && (
        <Alert type="warning" showIcon title="暂无法导入分析结果" description={blockedTip} />
      )}

      {analysisImportActive && (
        <ImportProgressAlert
          progress={importSession.progress || applyProgress}
          dataMonth={importSession.batchName}
        />
      )}

      {inModal ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => downloadImportAnalysisTemplate()}
            >
              下载空白模板（{TEMPLATE_COLUMN_COUNT} 列）
            </Button>
            <Typography.Text type="secondary" className="text-xs">
              列含义与必填项以下载模板表头为准（带 * 为必填）
            </Typography.Text>
          </div>
          {uploadBlock}
        </div>
      ) : (
        <>
          <Card title="模板与列说明">
            <Typography.Paragraph className="!mb-3 text-sm text-ink-700">
              表头共 {TEMPLATE_COLUMN_COUNT} 列，与
              <Typography.Text code>导出分析结果 v2</Typography.Text>
              一致；多余列将被忽略。排期可留空（R1，空=待评估）。
            </Typography.Paragraph>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => downloadImportAnalysisTemplate()}
            >
              下载空白模板（{TEMPLATE_COLUMN_COUNT} 列）
            </Button>
            <Table
              className="!mt-4"
              size="small"
              pagination={false}
              scroll={{ x: 480 }}
              dataSource={columnRows}
              columns={[
                { title: '序', dataIndex: 'order', width: 48 },
                { title: '列名', dataIndex: 'name' },
                {
                  title: '必填',
                  dataIndex: 'required',
                  width: 72,
                  render: (required) =>
                    required ? <Tag color="red">必填</Tag> : <Tag>可空</Tag>,
                },
              ]}
            />
          </Card>

          <Card title="上传分析结果">{uploadBlock}</Card>
        </>
      )}
    </div>
  )
}
