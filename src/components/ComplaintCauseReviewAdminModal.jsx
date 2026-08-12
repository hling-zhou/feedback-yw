import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Modal,
  Select,
  Space,
  Table,
  Typography,
  Upload,
  message,
} from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import * as XLSX from 'xlsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { isComplaintTicket } from '../domain/complaintCause.js'
import {
  COMPLAINT_CAUSE_REVIEW_ADMIN_EXPORT_HEADERS,
  COMPLAINT_CAUSE_REVIEW_DECISION_OPTIONS,
  isComplaintCauseReviewPending,
  mergeComplaintCauseReviewImportRow,
  toComplaintCauseReviewAdminRow,
} from '../domain/complaintCauseReviewArchive.js'
import { applyComplaintCauseReviewDecisions } from '../lib/complaintCauseReviewClient.js'

/**
 * @param {{ open: boolean; onClose: () => void }} props
 */
export default function ComplaintCauseReviewAdminModal({ open, onClose }) {
  const { feedbacks, ingestUpdatedRecords } = useInsights()
  const [rows, setRows] = useState(/** @type {ReturnType<typeof toComplaintCauseReviewAdminRow>[]} */ ([]))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const pending = feedbacks
      .filter((fb) => isComplaintTicket(fb) && isComplaintCauseReviewPending(fb))
      .map((fb) => toComplaintCauseReviewAdminRow(fb, ''))
    setRows(pending)
  }, [open, feedbacks])

  const decidedCount = useMemo(
    () => rows.filter((r) => r.decision === 'agree' || r.decision === 'reject').length,
    [rows],
  )

  const columns = [
    { title: '工单号', dataIndex: 'ticketId', width: 140, fixed: 'left' },
    { title: '产品名称', dataIndex: 'product', width: 120, ellipsis: true },
    { title: '原投诉原因一级（终判）', dataIndex: 'originalL1', width: 140, ellipsis: true },
    { title: '原投诉原因二级（终判）', dataIndex: 'originalL2', width: 140, ellipsis: true },
    { title: '原投诉原因三级（终判）', dataIndex: 'originalL3', width: 140, ellipsis: true },
    { title: '复核投诉原因一级（终判）', dataIndex: 'reviewL1', width: 140, ellipsis: true },
    { title: '复核投诉原因二级（终判）', dataIndex: 'reviewL2', width: 140, ellipsis: true },
    { title: '复核投诉原因三级（终判）', dataIndex: 'reviewL3', width: 140, ellipsis: true },
    { title: '申请原因', dataIndex: 'reason', width: 160, ellipsis: true },
    {
      title: '复核结果',
      dataIndex: 'decision',
      width: 120,
      fixed: 'right',
      render: (value, row) => (
        <Select
          allowClear
          placeholder="空"
          className="w-full"
          value={value || undefined}
          options={COMPLAINT_CAUSE_REVIEW_DECISION_OPTIONS}
          onChange={(next) => {
            setRows((prev) =>
              prev.map((item) =>
                item.recordId === row.recordId
                  ? { ...item, decision: next || '' }
                  : item,
              ),
            )
          }}
        />
      ),
    },
  ]

  const handleExport = () => {
    const aoa = [
      COMPLAINT_CAUSE_REVIEW_ADMIN_EXPORT_HEADERS,
      ...rows.map((r) => [
        r.ticketId,
        r.product,
        r.originalL1,
        r.originalL2,
        r.originalL3,
        r.reviewL1,
        r.reviewL2,
        r.reviewL3,
        r.reason,
        r.decision === 'agree' ? '同意' : r.decision === 'reject' ? '拒绝' : '',
      ]),
    ]
    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, '投诉原因复核')
    XLSX.writeFile(wb, `投诉原因复核_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const handleImport = async (file) => {
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const imported = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const byTicketId = new Map(rows.map((r) => [r.ticketId, r]))
      let hit = 0
      for (const raw of imported) {
        const merged = mergeComplaintCauseReviewImportRow(raw, byTicketId)
        if (!merged) continue
        byTicketId.set(merged.ticketId, merged)
        hit += 1
      }
      setRows(rows.map((r) => byTicketId.get(r.ticketId) || r))
      message.success(`已按工单号覆盖 ${hit} 条复核结果`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败')
    }
    return false
  }

  const handleSave = () => {
    const toApply = rows.filter((r) => r.decision === 'agree' || r.decision === 'reject')
    if (!toApply.length) {
      message.warning('请先填写至少一条复核结果（同意/拒绝）')
      return
    }
    Modal.confirm({
      title: '确认保存复核结果？',
      content: `将对 ${toApply.length} 条工单归档。同意将更新终判；拒绝不改终判。保存后不可二次编辑，详情中的拟复核将被清空。`,
      okText: '确认保存',
      cancelText: '取消',
      onOk: async () => {
        setSaving(true)
        try {
          const result = await applyComplaintCauseReviewDecisions(
            toApply.map((r) => ({
              recordId: r.recordId,
              decision: /** @type {'agree' | 'reject'} */ (r.decision),
            })),
          )
          if (Array.isArray(result?.updatedRecords)) {
            ingestUpdatedRecords?.(result.updatedRecords)
          }
          const errCount = Array.isArray(result?.errors) ? result.errors.length : 0
          if (errCount) {
            message.warning(`已归档 ${result.appliedCount || 0} 条，失败 ${errCount} 条`)
          } else {
            message.success(`已归档 ${result.appliedCount || toApply.length} 条`)
          }
          onClose()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '保存失败')
        } finally {
          setSaving(false)
        }
      },
    })
  }

  return (
    <Modal
      title="投诉原因复核"
      open={open}
      onCancel={onClose}
      width={1200}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存{decidedCount ? `（${decidedCount}）` : ''}
          </Button>
        </Space>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Typography.Text type="secondary">
          列出已填写拟复核的投诉工单。导入以工单号覆盖复核结果。
        </Typography.Text>
        <div className="ml-auto flex gap-2">
          <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!rows.length}>
            导出
          </Button>
          <Upload accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={handleImport}>
            <Button icon={<UploadOutlined />} disabled={!rows.length}>
              导入
            </Button>
          </Upload>
        </div>
      </div>
      <Table
        size="small"
        rowKey="recordId"
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1600, y: 480 }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        locale={{ emptyText: '暂无拟复核工单' }}
      />
    </Modal>
  )
}
