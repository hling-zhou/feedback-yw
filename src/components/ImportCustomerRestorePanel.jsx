import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { Alert, Button, Modal, Table, Tag, Typography, Upload, message } from 'antd'
import { useCallback, useState } from 'react'
import { ImportProgressAlert } from './TaggingProgressAlert.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { useSharedBackgroundTaskBlock } from '../hooks/useSharedBackgroundTaskBlock.js'
import { CUSTOMER_RESTORE_PROFILE_COLUMNS } from '../lib/customerRestore/constants.js'
import { parseAndValidateCustomerRestoreSheet } from '../lib/customerRestore/customerRestoreImport.js'
import { downloadCustomerRestoreTemplate } from '../lib/customerRestore/customerRestoreTemplate.js'
import { validateImportFile, validateRowCount } from '../lib/importUtils.js'
import { parseUploadFile } from '../lib/parseFile.js'

/**
 * @param {{
 *   onImportComplete?: (summary: {
 *     appliedRowCount: number
 *     skippedRowCount: number
 *     updatedRecordCount: number
 *     skippedUnknownTicketIds: string[]
 *   }) => void
 * }} props
 */
export default function ImportCustomerRestorePanel({ onImportComplete }) {
  const {
    importCustomerRestore,
    storageReady,
    reprocessing,
    importSession,
  } = useInsights()
  const { importBlocked, importBlockedTip, retagBlockedTip } =
    useSharedBackgroundTaskBlock()

  const [parsing, setParsing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [validation, setValidation] = useState(null)
  const [applySummary, setApplySummary] = useState(null)
  const [fileName, setFileName] = useState('')
  const [applyProgress, setApplyProgress] = useState('')

  const restoreActive = importSession.active && importSession.kind === 'customer_restore'
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
          headerMatch: { ok: false, identityHeaders: [], extraHeaders: [], missingTicket: false },
          validRows: [],
          skippedEmptyRows: 0,
          rowErrors: [],
        })
        return Upload.LIST_IGNORE
      }

      const result = parseAndValidateCustomerRestoreSheet({ headers, rows })
      setValidation(result)
      if (result.fileError) {
        message.error(result.fileError)
      } else if (result.ok) {
        message.success(`校验通过：${result.validRows.length} 个工单可复原`)
      } else {
        message.warning(
          `校验完成：${result.validRows.length} 个工单可写，${result.rowErrors.length} 处错误`,
        )
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : '解析文件失败'
      message.error(text)
      setValidation({
        ok: false,
        fileError: text,
        headerMatch: { ok: false, identityHeaders: [], extraHeaders: [], missingTicket: false },
        validRows: [],
        skippedEmptyRows: 0,
        rowErrors: [],
      })
    } finally {
      setParsing(false)
    }

    return Upload.LIST_IGNORE
  }, [blocked, blockedTip])

  const handleApply = useCallback(() => {
    if (!validation?.validRows.length || blocked) return

    Modal.confirm({
      title: '确认复原客户信息？',
      content: (
        <>
          将按<strong>工单号</strong>回写库内已有记录的客户名称/编码等身份字段。
          空单元格不覆盖已有值，不会新建工单，也不会改分析正文。
          <br />
          本次可写入 <strong>{validation.validRows.length}</strong> 个工单号。
        </>
      ),
      okText: '确认导入',
      cancelText: '取消',
      onOk: async () => {
        setApplying(true)
        setApplySummary(null)
        setApplyProgress('准备导入…')
        try {
          const summary = await importCustomerRestore(validation.validRows, setApplyProgress)
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
                  ? `，跳过未匹配 ${summary.skippedRowCount} 个工单号`
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
  }, [blocked, importCustomerRestore, onImportComplete, validation])

  const canApply =
    storageReady &&
    !blocked &&
    !parsing &&
    !applying &&
    validation &&
    !validation.fileError &&
    validation.validRows.length > 0

  return (
    <div className="space-y-3">
      <Alert
        type="warning"
        showIcon
        message={(
          <span>
            临时入口
            <Tag color="orange" className="ml-2">可下架</Tag>
          </span>
        )}
        description="用于回填 8 月之前已脱敏工单的客户名称/编码。1～7 月已复原。8 月及以后导入的数据会自带这些字段，本入口将下架。用后即评仅当记录带原工单号时同步。"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<DownloadOutlined />} onClick={() => downloadCustomerRestoreTemplate()}>
          下载模板
        </Button>
        <Typography.Text type="secondary" className="text-xs">
          必填工单号；建议列：{CUSTOMER_RESTORE_PROFILE_COLUMNS.join('、')}
        </Typography.Text>
      </div>
      <Upload.Dragger
        accept=".csv,.xlsx,.xls"
        showUploadList={false}
        disabled={parsing || applying || blocked || restoreActive}
        beforeUpload={handleUpload}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          {parsing ? '正在解析…' : '点击或拖拽上传客户复原 Excel / CSV'}
        </p>
        <p className="ant-upload-hint">按工单号匹配已有记录；空单元格不覆盖</p>
      </Upload.Dragger>

      {restoreActive ? <ImportProgressAlert progress={importSession.progress} /> : null}

      {validation && (
        <div className="space-y-3">
          {fileName ? (
            <Typography.Text type="secondary" className="text-xs">
              文件：{fileName}
            </Typography.Text>
          ) : null}
          {validation.fileError ? (
            <Alert type="error" showIcon title="无法导入" description={validation.fileError} />
          ) : (
            <Alert
              type={validation.ok ? 'success' : 'warning'}
              showIcon
              title={validation.ok ? '校验通过' : '校验发现问题'}
              description={
                <>
                  可写入 {validation.validRows.length} 个工单号
                  {validation.skippedEmptyRows > 0 ? `，空行 ${validation.skippedEmptyRows}` : ''}
                  {validation.rowErrors.length > 0 ? `，错误 ${validation.rowErrors.length} 处` : ''}
                  {validation.headerMatch.extraHeaders.length > 0 ? (
                    <>；已忽略多余列：{validation.headerMatch.extraHeaders.join('、')}</>
                  ) : null}
                </>
              }
            />
          )}
          {validation.rowErrors.length > 0 ? (
            <Table
              size="small"
              pagination={{ pageSize: 8, showSizeChanger: false }}
              rowKey={(row) => `${row.rowIndex}-${row.message}`}
              dataSource={validation.rowErrors}
              columns={[
                { title: '行', dataIndex: 'rowIndex', width: 56 },
                { title: '说明', dataIndex: 'message' },
              ]}
            />
          ) : null}
          {canApply ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="primary" loading={applying} onClick={handleApply}>
                复原 {validation.validRows.length} 个工单
              </Button>
              {applyProgress ? (
                <Typography.Text type="secondary" className="text-xs">
                  {applyProgress}
                </Typography.Text>
              ) : null}
            </div>
          ) : null}
          {applySummary ? (
            <Alert
              type={applySummary.updatedRecordCount ? 'success' : 'info'}
              showIcon
              title="导入完成"
              description={
                <>
                  匹配 {applySummary.appliedRowCount} 个工单号，更新记录 {applySummary.updatedRecordCount} 条
                  {applySummary.unchangedRecordCount
                    ? `，已有值无需改写 ${applySummary.unchangedRecordCount} 条`
                    : ''}
                  {applySummary.skippedRowCount > 0
                    ? `；未匹配库内工单 ${applySummary.skippedRowCount} 个`
                    : ''}
                  {applySummary.skippedUnknownTicketIds.length > 0 ? (
                    <div className="!mt-2 text-xs">
                      未匹配工单号：
                      {applySummary.skippedUnknownTicketIds.slice(0, 20).join('、')}
                      {applySummary.skippedUnknownTicketIds.length > 20 ? '…' : ''}
                    </div>
                  ) : null}
                </>
              }
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
