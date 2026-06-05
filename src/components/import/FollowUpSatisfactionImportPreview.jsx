import { Alert, Button, Space, Table, Typography } from 'antd'
import { downloadUnmatchedFollowUpCsv } from '../../lib/followUpSatisfactionImport.js'

/**
 * @param {import('../../lib/followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary | null} summary
 */
export function formatFollowUpImportSummaryDescription(summary) {
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

/**
 * @param {Object} props
 * @param {import('../../lib/followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary | null} props.preview
 * @param {boolean} [props.loading]
 * @param {string} [props.error]
 */
export function FollowUpSatisfactionImportPreview({ preview, loading, error }) {
  const previewTableData = preview
    ? [
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
    : []

  if (loading) {
    return (
      <Typography.Text type="secondary" className="block text-xs">
        正在匹配工单并生成预览…
      </Typography.Text>
    )
  }

  if (error) {
    return <Alert type="error" showIcon title="预览失败" description={error} />
  }

  if (!preview) return null

  return (
    <div className="space-y-3">
      <Alert
        type={preview.appliedRowCount > 0 ? 'success' : 'warning'}
        showIcon
        title="匹配预览"
        description={formatFollowUpImportSummaryDescription(preview)}
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
      {preview.unmatched.length > 0 && (
        <Space wrap>
          <Button size="small" onClick={() => downloadUnmatchedFollowUpCsv(preview.unmatched)}>
            下载未匹配 CSV
          </Button>
        </Space>
      )}
    </div>
  )
}

/**
 * @param {Object} props
 * @param {import('../../lib/columnPresets.js').ColumnPreset | null} props.preset
 * @param {string[]} props.headers
 */
export function FollowUpSatisfactionColumnMapping({ preset, headers }) {
  if (!preset) {
    return (
      <Alert
        type="warning"
        showIcon
        title="未识别满意度回访表头"
        description="需包含「回访工单编号」「原工单编号」等列。"
      />
    )
  }

  const rows = Object.entries(preset.columnMap).map(([key, header]) => ({
    key,
    field: key,
    header,
    present: headers.includes(header),
  }))

  return (
    <div className="space-y-3">
      <Alert
        type="info"
        showIcon
        title={`已识别为「${preset.name}」格式`}
        description="按原工单号补全投诉/咨询工单，不新增用后即评独立记录；列映射由模板锁定。"
      />
      <Table
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: '系统字段', dataIndex: 'field', width: 180 },
          { title: 'Excel 列名', dataIndex: 'header' },
          {
            title: '状态',
            dataIndex: 'present',
            width: 88,
            render: (present) => (present ? '已识别' : '缺失'),
          },
        ]}
      />
    </div>
  )
}
