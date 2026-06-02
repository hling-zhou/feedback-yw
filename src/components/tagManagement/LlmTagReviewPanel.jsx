import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import {
  CopyOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  MergeCellsOutlined,
} from '@ant-design/icons'
import Papa from 'papaparse'
import { useInsights } from '../../context/InsightsContext.jsx'
import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import {
  TAG_TYPE_LABELS,
  buildTagCandidateMeaning,
  buildTagCandidateReviewHint,
  exportCandidatesToCsv,
  getTagCandidateTarget,
  groupTagCandidates,
  countPendingDuplicateCandidates,
} from '../../lib/tagCandidates.js'
import { getTagLibraryVersion } from '../../lib/taxonomyLoader.js'

const STATUS_LABELS = {
  pending: { color: 'orange', text: '待复核' },
  approved: { color: 'green', text: '已采纳' },
  rejected: { color: 'default', text: '已拒绝' },
  merged: { color: 'blue', text: '已合并到服务端' },
}

function buildColumns({ onApprove, onReject, readOnly }) {
  const cols = [
    {
      title: '提议标签',
      dataIndex: 'proposedLabel',
      width: 200,
      render: (v, row) => (
        <div>
          <Typography.Text strong>{v}</Typography.Text>
          <Typography.Text type="secondary" className="block text-xs">
            {buildTagCandidateReviewHint(row)}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '写入位置',
      key: 'target',
      width: 220,
      render: (_, row) => {
        const target = getTagCandidateTarget(row)
        return (
          <div>
            <Tag color={row.tagType === 'problem_type' ? 'blue' : 'purple'}>
              {target.tabTitle}
            </Tag>
            <Typography.Text type="secondary" className="mt-1 block text-xs leading-snug">
              {target.adoptTarget}
            </Typography.Text>
          </div>
        )
      },
    },
    {
      title: '标签释义',
      key: 'tagMeaning',
      render: (_, row) => {
        const text = row.tagMeaning || buildTagCandidateMeaning(row)
        return (
          <Typography.Paragraph
            className="!mb-0 text-xs leading-relaxed text-gray-700"
            ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}
          >
            {text}
          </Typography.Paragraph>
        )
      },
    },
    {
      title: '次数',
      dataIndex: 'occurrenceCount',
      width: 64,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s) => {
        const meta = STATUS_LABELS[s] || { text: s, color: 'default' }
        return <Tag color={meta.color}>{meta.text}</Tag>
      },
    },
  ]
  if (!readOnly) {
    cols.push({
      title: '操作',
      width: 140,
      render: (_, row) =>
        row.status === 'pending' ? (
          <Space>
            <Button type="link" size="small" onClick={() => onApprove(row)}>
              采纳
            </Button>
            <Button type="link" size="small" danger onClick={() => onReject(row.id)}>
              拒绝
            </Button>
          </Space>
        ) : null,
    })
  }
  return cols
}

/** LLM 提议标签复核（嵌入标签管理） */
export default function LlmTagReviewPanel({ readOnly = false }) {
  const message = useAppMessage()
  const {
    tagCandidates,
    tagCandidatesLoading,
    reloadTagCandidates,
    mergeDuplicateTagCandidates,
    approveTagCandidate,
    approveTagCandidates,
    rejectTagCandidate,
    rejectTagCandidates,
    markSnapshotsStale,
    exportTaxonomyPatch,
    markTagCandidatesMerged,
  } = useInsights()

  const [statusFilter, setStatusFilter] = useState('pending')
  const [activeGroupKey, setActiveGroupKey] = useState('problem_type')
  const [selectedRowKeys, setSelectedRowKeys] = useState(/** @type {string[]} */ ([]))
  const [approving, setApproving] = useState(null)
  const [batchApproving, setBatchApproving] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [mergingDupes, setMergingDupes] = useState(false)

  const statusFiltered = useMemo(() => {
    if (!statusFilter) return tagCandidates
    return tagCandidates.filter((c) => c.status === statusFilter)
  }, [tagCandidates, statusFilter])

  const groups = useMemo(() => groupTagCandidates(statusFiltered), [statusFiltered])

  useEffect(() => {
    if (!groups.length) return
    const exists = groups.some((g) => g.target.groupKey === activeGroupKey)
    if (!exists) setActiveGroupKey(groups[0].target.groupKey)
  }, [groups, activeGroupKey])

  useEffect(() => {
    setSelectedRowKeys([])
  }, [statusFilter])

  const pendingIdSet = useMemo(
    () => new Set(tagCandidates.filter((c) => c.status === 'pending').map((c) => c.id)),
    [tagCandidates],
  )

  const selectedPendingIds = useMemo(
    () => selectedRowKeys.filter((id) => pendingIdSet.has(id)),
    [selectedRowKeys, pendingIdSet],
  )

  const selectedPendingCandidates = useMemo(
    () => tagCandidates.filter((c) => selectedPendingIds.includes(c.id)),
    [tagCandidates, selectedPendingIds],
  )

  const rowSelection = readOnly
    ? undefined
    : {
        selectedRowKeys,
        onChange: (keys) => setSelectedRowKeys(keys.map(String)),
        getCheckboxProps: (record) => ({
          disabled: record.status !== 'pending',
        }),
      }

  const pendingCount = tagCandidates.filter((c) => c.status === 'pending').length
  const approvedCount = tagCandidates.filter((c) => c.status === 'approved').length
  const duplicatePendingCount = useMemo(
    () => countPendingDuplicateCandidates(tagCandidates),
    [tagCandidates],
  )

  const columns = useMemo(
    () =>
      buildColumns({
        readOnly,
        onApprove: (row) => {
          setApproving(row)
          setReviewNote('')
        },
        onReject: (id) => rejectTagCandidate(id),
      }),
    [readOnly, rejectTagCandidate],
  )

  const exportCsv = () => {
    const activeGroup = groups.find((g) => g.target.groupKey === activeGroupKey)
    const rows = exportCandidatesToCsv(activeGroup?.items || statusFiltered)
    const csv = Papa.unparse(rows)
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tag-candidates.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExport = async (format) => {
    setExporting(true)
    try {
      const result = await exportTaxonomyPatch(format)
      if (format === 'copy') {
        if (result.copied) message.success('已复制 JSON 合并包到剪贴板')
        else message.warning('无法访问剪贴板，请改用下载 JSON')
      } else if (format === 'excel') {
        message.success('已下载 Excel 合并行（可追加到打标配置）')
      } else {
        message.success('已下载 JSON 合并包')
      }
    } catch (e) {
      message.error(e.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const tabItems = groups.map((g) => ({
    key: g.target.groupKey,
    label: `${g.target.tabTitle}（${g.items.length}）`,
    children: (
      <Table
        rowKey="id"
        size="small"
        loading={tagCandidatesLoading}
        dataSource={g.items}
        columns={columns}
        rowSelection={rowSelection}
        pagination={{ pageSize: 20 }}
      />
    ),
  }))

  const approvingTarget = approving ? getTagCandidateTarget(approving) : null

  return (
    <div>
      <Alert
        type="info"
        showIcon
        title={`当前标签库版本：${getTagLibraryVersion()} · 待复核 ${pendingCount} 条 · 待合并到服务端 ${approvedCount} 条`}
        description={
          <ul className="mb-0 list-disc pl-5 text-sm">
            <li>
              数据导入或批量重新打标时，若 LLM 无法匹配现有标签，会<strong>先按提议标签写入工单</strong>并在此列出待复核；采纳后正式并入标签库
            </li>
            <li>
              <strong>请求场景 / 问题类型</strong>：采纳后写入本机标签库，在「标签管理 → 请求场景 / 问题类型」查看与导出
            </li>
            <li>
              <strong>用户旅程</strong>：按产品写入对应模板，在「标签管理 → 用户旅程」维护；保存后写入共享库并自动生成磁盘备份
            </li>
            <li>
              若列表出现相同提议标签的多行，可使用下方<strong>合并重复项</strong>（按类型+产品+标签名合并，累加出现次数）
            </li>
          </ul>
        }
      />

      <Card className="mt-4" size="small" title="合并到服务端配置">
        <Space wrap>
          <Button
            icon={<FileExcelOutlined />}
            loading={exporting}
            onClick={() => handleExport('excel')}
          >
            导出 Excel 合并行
          </Button>
          <Button
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={() => handleExport('json')}
          >
            下载 JSON 合并包
          </Button>
          <Button
            icon={<CopyOutlined />}
            loading={exporting}
            onClick={() => handleExport('copy')}
          >
            复制 JSON 到剪贴板
          </Button>
          {!readOnly && (
            <Button
              disabled={!approvedCount}
              onClick={async () => {
                await markTagCandidatesMerged()
                message.success('已将已采纳项标记为「已合并到服务端」')
              }}
            >
              标记已合并（{approvedCount}）
            </Button>
          )}
        </Space>
      </Card>

      <Card className="mt-6">
        <Space wrap className="mb-4">
          <Select
            className="min-w-[140px]"
            value={statusFilter}
            options={[
              { label: '待复核', value: 'pending' },
              { label: '已采纳', value: 'approved' },
              { label: '已合并到服务端', value: 'merged' },
              { label: '已拒绝', value: 'rejected' },
              { label: '全部', value: '' },
            ]}
            onChange={setStatusFilter}
          />
          <Button onClick={() => reloadTagCandidates()} loading={tagCandidatesLoading}>
            刷新
          </Button>
          {!readOnly && (
            <Button
              icon={<MergeCellsOutlined />}
              loading={mergingDupes || tagCandidatesLoading}
              disabled={!duplicatePendingCount}
              onClick={async () => {
                setMergingDupes(true)
                try {
                  const { removedCount } = await mergeDuplicateTagCandidates()
                  if (removedCount > 0) {
                    message.success(`已合并 ${removedCount} 条重复待复核标签`)
                  } else {
                    message.info('当前没有可合并的重复项')
                  }
                } catch (e) {
                  message.error(e.message || '合并失败')
                } finally {
                  setMergingDupes(false)
                }
              }}
            >
              合并重复项
              {duplicatePendingCount > 0 ? `（${duplicatePendingCount}）` : ''}
            </Button>
          )}
          <Button
            disabled={!statusFiltered.length}
            onClick={exportCsv}
            icon={<FileTextOutlined />}
          >
            导出当前 Tab CSV
          </Button>
          {!readOnly && selectedPendingIds.length > 0 && (
            <>
              <Button
                type="primary"
                loading={batchProcessing}
                onClick={() => {
                  setReviewNote('')
                  setBatchApproving(true)
                }}
              >
                批量采纳（{selectedPendingIds.length}）
              </Button>
              <Button
                danger
                loading={batchProcessing}
                onClick={() => {
                  Modal.confirm({
                    title: '批量拒绝',
                    content: `确定拒绝选中的 ${selectedPendingIds.length} 条待复核标签？`,
                    okText: '确认拒绝',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: async () => {
                      setBatchProcessing(true)
                      try {
                        const rejected = await rejectTagCandidates(selectedPendingIds)
                        setSelectedRowKeys([])
                        message.success(`已拒绝 ${rejected.length} 条标签`)
                      } catch (e) {
                        message.error(e.message || '批量拒绝失败')
                      } finally {
                        setBatchProcessing(false)
                      }
                    },
                  })
                }}
              >
                批量拒绝（{selectedPendingIds.length}）
              </Button>
            </>
          )}
        </Space>

        {tabItems.length ? (
          <Tabs activeKey={activeGroupKey} onChange={setActiveGroupKey} items={tabItems} />
        ) : (
          <Typography.Text type="secondary">当前筛选下暂无候选标签</Typography.Text>
        )}
      </Card>

      {!readOnly && (
        <Modal
          title={`批量采纳（${selectedPendingCandidates.length} 条）`}
          open={batchApproving}
          onCancel={() => setBatchApproving(false)}
          footer={[
            <Button key="cancel" onClick={() => setBatchApproving(false)}>
              取消
            </Button>,
            <Button
              key="ok"
              type="primary"
              loading={batchProcessing}
              onClick={async () => {
                setBatchProcessing(true)
                try {
                  const result = await approveTagCandidates(selectedPendingIds, reviewNote)
                  setBatchApproving(false)
                  setSelectedRowKeys([])
                  markSnapshotsStale()
                  message.success(`已采纳 ${result.approved.length} 条并写入本机标签库`)
                } catch (e) {
                  message.error(e.message || '批量采纳失败')
                } finally {
                  setBatchProcessing(false)
                }
              }}
            >
              确认批量采纳
            </Button>,
          ]}
        >
          <div className="space-y-3 pt-2">
            <Typography.Text type="secondary" className="block text-sm">
              以下标签将写入本机标签库对应位置：
            </Typography.Text>
            <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm">
              {selectedPendingCandidates.map((c) => {
                const target = getTagCandidateTarget(c)
                return (
                  <li key={c.id} className="mb-1">
                    <Typography.Text strong>{c.proposedLabel}</Typography.Text>
                    <Typography.Text type="secondary" className="ml-2 text-xs">
                      → {target.tabTitle}
                    </Typography.Text>
                  </li>
                )
              })}
            </ul>
            <Input.TextArea
              rows={2}
              placeholder="复核备注（可选，将应用于全部选中项）"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
            />
          </div>
        </Modal>
      )}

      {!readOnly && (
        <Modal
          title="采纳标签"
          open={Boolean(approving)}
          onCancel={() => setApproving(null)}
          footer={[
            <Button key="cancel" onClick={() => setApproving(null)}>
              取消
            </Button>,
            <Button
              key="ok"
              type="primary"
              onClick={async () => {
                if (!approving) return
                await approveTagCandidate(approving.id, reviewNote)
                setApproving(null)
                markSnapshotsStale()
                message.success(
                  '已采纳并写入共享标签库；可在「标签管理」对应 Tab 查看，其他用户约 5 秒内同步',
                )
              }}
            >
              确认采纳
            </Button>,
          ]}
        >
          {approving && approvingTarget && (
            <div className="space-y-3 pt-2">
              <Typography.Text>
                将添加：<strong>{approving.proposedLabel}</strong>
              </Typography.Text>
              <Alert
                type="warning"
                showIcon
                title="写入位置"
                description={
                  <div className="text-sm">
                    <div>{approvingTarget.tabTitle}</div>
                    <div className="mt-1 font-mono text-xs">{approvingTarget.adoptTarget}</div>
                    <div className="mt-1 text-gray-600">{approvingTarget.excelSheet}</div>
                  </div>
                }
              />
              <Alert
                type="info"
                showIcon
                title="标签释义"
                description={approving.tagMeaning || buildTagCandidateMeaning(approving)}
              />
              <Typography.Text type="secondary" className="block text-xs">
                {TAG_TYPE_LABELS[approving.tagType]} · {buildTagCandidateReviewHint(approving)}
                {approving.dataSourceType
                  ? ` · ${DATA_SOURCE_LABELS[approving.dataSourceType]}`
                  : ''}
              </Typography.Text>
              <Input.TextArea
                rows={2}
                placeholder="复核备注（可选）"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
