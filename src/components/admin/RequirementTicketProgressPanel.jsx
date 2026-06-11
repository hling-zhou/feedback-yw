import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  Space,
  Table,
  Typography,
  Upload,
} from 'antd'
import { DownloadOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import {
  ACTION_ITEM_STATUSES,
  ACTION_ITEM_STATUS_LABELS,
} from '../../domain/actionItem.js'
import {
  importRequirementTicketProgress,
  listRequirementStatusMappings,
  listRequirementTicketProgress,
  saveRequirementStatusMappings,
} from '../../lib/requirementTicketProgressClient.js'
import {
  buildRequirementProgressTemplateBuffer,
  parseRequirementProgressWorkbook,
} from '../../lib/requirementTicketProgressImport.js'

/** @typedef {import('../../domain/requirementTicketProgress.js').RequirementTicketProgressRow} RequirementTicketProgressRow */
/** @typedef {import('../../domain/requirementTicketProgress.js').RequirementStatusMappingRow} RequirementStatusMappingRow */

const STATUS_OPTIONS = ACTION_ITEM_STATUSES.map((status) => ({
  value: status,
  label: ACTION_ITEM_STATUS_LABELS[status],
}))

const PROGRESS_PAGE_SIZE = 50

function createEmptyMappingRow() {
  return {
    key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    workflowStatus: '',
    mapsToActionStatus: /** @type {import('../../domain/actionItem.js').ActionItemStatus} */ ('in_progress'),
    sortOrder: 0,
  }
}

export default function RequirementTicketProgressPanel() {
  const message = useAppMessage()
  const [progressItems, setProgressItems] = useState(/** @type {RequirementTicketProgressRow[]} */ ([]))
  const [progressTotal, setProgressTotal] = useState(0)
  const [progressLoading, setProgressLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [mappingRows, setMappingRows] = useState(
    /** @type {(RequirementStatusMappingRow & { key: string })[]} */ ([]),
  )
  const [mappingLoading, setMappingLoading] = useState(false)
  const [mappingSaving, setMappingSaving] = useState(false)

  const [ticketFilter, setTicketFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [progressPage, setProgressPage] = useState(1)

  const loadMappings = useCallback(async () => {
    setMappingLoading(true)
    try {
      const items = await listRequirementStatusMappings()
      setMappingRows(
        items.map((item, index) => ({
          ...item,
          key: item.workflowStatus || `row-${index}`,
        })),
      )
    } catch (err) {
      setMappingRows([])
      message.error(err instanceof Error ? err.message : '加载状态映射失败')
    } finally {
      setMappingLoading(false)
    }
  }, [message])

  const loadProgress = useCallback(
    async (page) => {
      setProgressLoading(true)
      try {
        const data = await listRequirementTicketProgress({
          ticketId: ticketFilter.trim() || undefined,
          product: productFilter.trim() || undefined,
          workflowStatus: statusFilter.trim() || undefined,
          limit: PROGRESS_PAGE_SIZE,
          offset: (page - 1) * PROGRESS_PAGE_SIZE,
        })
        setProgressItems(data.items)
        setProgressTotal(data.total)
      } catch (err) {
        setProgressItems([])
        setProgressTotal(0)
        message.error(err instanceof Error ? err.message : '加载进展数据失败')
      } finally {
        setProgressLoading(false)
      }
    },
    [message, productFilter, statusFilter, ticketFilter],
  )

  const handleProgressSearch = useCallback(() => {
    setProgressPage(1)
    void loadProgress(1)
  }, [loadProgress])

  const handleProgressPageChange = useCallback(
    (page) => {
      setProgressPage(page)
      void loadProgress(page)
    },
    [loadProgress],
  )

  useEffect(() => {
    void loadMappings()
    void loadProgress(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 进展表仅在查询、翻页、导入后刷新
  }, [loadMappings])

  const mappingColumns = useMemo(
    () => [
      {
        title: '外部操作状态',
        dataIndex: 'workflowStatus',
        render: (value, record) => (
          <Input
            value={value}
            placeholder="如：开发中"
            onChange={(e) =>
              setMappingRows((prev) =>
                prev.map((row) =>
                  row.key === record.key ? { ...row, workflowStatus: e.target.value } : row,
                ),
              )
            }
          />
        ),
      },
      {
        title: '映射为举措状态',
        dataIndex: 'mapsToActionStatus',
        width: 180,
        render: (value, record) => (
          <Select
            className="w-full"
            value={value}
            options={STATUS_OPTIONS}
            onChange={(next) =>
              setMappingRows((prev) =>
                prev.map((row) =>
                  row.key === record.key ? { ...row, mapsToActionStatus: next } : row,
                ),
              )
            }
          />
        ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 80,
        render: (_, record) => (
          <Button
            type="link"
            danger
            onClick={() => setMappingRows((prev) => prev.filter((row) => row.key !== record.key))}
          >
            删除
          </Button>
        ),
      },
    ],
    [],
  )

  const progressColumns = [
    { title: '需求工单号', dataIndex: 'ticketId', width: 140 },
    { title: '产品', dataIndex: 'product', width: 100 },
    { title: '排期时间', dataIndex: 'scheduleAt', width: 120 },
    { title: '状态', dataIndex: 'workflowStatus', width: 120 },
    {
      title: '最近更新',
      dataIndex: 'updatedAt',
      width: 168,
      render: (value) => (value ? new Date(value).toLocaleString('zh-CN') : '—'),
    },
  ]

  const saveMappings = async () => {
    setMappingSaving(true)
    try {
      const items = mappingRows
        .map((row, index) => ({
          workflowStatus: row.workflowStatus.trim(),
          mapsToActionStatus: row.mapsToActionStatus,
          sortOrder: index,
        }))
        .filter((row) => row.workflowStatus)
      const result = await saveRequirementStatusMappings(items)
      setMappingRows(
        (result.items || []).map((item, index) => ({
          ...item,
          key: item.workflowStatus || `row-${index}`,
        })),
      )
      message.success('状态映射已保存')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存状态映射失败')
    } finally {
      setMappingSaving(false)
    }
  }

  const handleImportFile = async (file) => {
    setImporting(true)
    try {
      const buffer = await file.arrayBuffer()
      const parsed = parseRequirementProgressWorkbook(buffer)
      if (!parsed.rows.length) {
        message.warning('未解析到有效数据行')
        return false
      }
      const result = await importRequirementTicketProgress(parsed.rows)
      const errorCount = (parsed.errors?.length || 0) + (result.errors?.length || 0)
      message.success(
        `导入完成：新增 ${result.inserted || 0} 条，更新 ${result.updated || 0} 条${
          errorCount ? `，${errorCount} 条有误已跳过` : ''
        }`,
      )
      setProgressPage(1)
      await loadProgress(1)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
    return false
  }

  const downloadTemplate = () => {
    const buffer = buildRequirementProgressTemplateBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = '需求工单进展导入模板.xlsx'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <Alert
        type="info"
        showIcon
        message="举措关联需求工单后，列表排期与状态由此模块同步展示；不在本次导入清单中的历史工单不会被删除。"
      />

      <Card
        title="状态映射配置"
        extra={
          <Space>
            <Button icon={<PlusOutlined />} onClick={() => setMappingRows((prev) => [...prev, createEmptyMappingRow()])}>
              新增映射
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={mappingSaving}
              onClick={() => void saveMappings()}
            >
              保存映射
            </Button>
          </Space>
        }
      >
        <Typography.Text type="secondary" className="mb-3 block text-xs">
          多个外部操作状态可映射到同一举措状态；未配置映射的状态在举措列表显示为「未映射」。
        </Typography.Text>
        <Table
          size="small"
          loading={mappingLoading}
          rowKey="key"
          pagination={false}
          columns={mappingColumns}
          dataSource={mappingRows}
        />
      </Card>

      <Card title="进展数据">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Space wrap>
            <Input
              allowClear
              placeholder="工单号"
              value={ticketFilter}
              onChange={(e) => setTicketFilter(e.target.value)}
              onPressEnter={() => handleProgressSearch()}
              style={{ width: 160 }}
            />
            <Input
              allowClear
              placeholder="产品"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              onPressEnter={() => handleProgressSearch()}
              style={{ width: 140 }}
            />
            <Input
              allowClear
              placeholder="外部状态"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              onPressEnter={() => handleProgressSearch()}
              style={{ width: 140 }}
            />
            <Button icon={<ReloadOutlined />} loading={progressLoading} onClick={() => handleProgressSearch()}>
              查询
            </Button>
          </Space>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
              下载模板
            </Button>
            <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleImportFile}>
              <Button type="primary" icon={<UploadOutlined />} loading={importing}>
                导入 Excel
              </Button>
            </Upload>
          </Space>
        </div>
        <Table
          size="small"
          loading={progressLoading}
          rowKey="ticketId"
          columns={progressColumns}
          dataSource={progressItems}
          scroll={{ x: 720 }}
          pagination={{
            current: progressPage,
            pageSize: PROGRESS_PAGE_SIZE,
            total: progressTotal,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page) => handleProgressPageChange(page),
          }}
        />
      </Card>
    </div>
  )
}
