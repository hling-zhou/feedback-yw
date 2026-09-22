import { useCallback, useEffect, useState } from 'react'
import { Drawer, Table, Tag, Button, Space, Tooltip, Modal } from 'antd'
import { ReloadOutlined, StopOutlined } from '@ant-design/icons'
import { apiFetch } from '../lib/apiClient.js'
import { useInsights } from '../context/InsightsContext.jsx'
import { backgroundTaskTypeLabel } from '../domain/backgroundTaskLock.js'

/**
 * @typedef {Object} TaskHistoryEntry
 * @property {string} id
 * @property {string} type
 * @property {string} source
 * @property {string} [scope]
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {'success' | 'failed'} status
 * @property {Record<string, unknown>} [summary]
 * @property {string} [error]
 * @property {string} [username]
 */

/**
 * @param {{ open: boolean; onClose: () => void }} props
 */
export default function TaskHistoryPanel({ open, onClose }) {
  const { sharedBackgroundTask: activeLock } = useInsights()
  const [history, setHistory] = useState(/** @type {TaskHistoryEntry[]} */ ([]))
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const histRes = await apiFetch('/api/storage/background-task/history')
      setHistory(Array.isArray(histRes?.history) ? histRes.history : [])
    } catch (err) {
      console.error('[TaskHistoryPanel] 加载失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleCancel = useCallback(async () => {
    Modal.confirm({
      title: '确认取消任务',
      content: '取消后已处理的记录不会写盘，数据保持取消前的状态。确定取消吗？',
      okText: '取消任务',
      okType: 'danger',
      cancelText: '不取消',
      onOk: async () => {
        setCancelling(true)
        try {
          await apiFetch('/api/storage/background-task/cancel', { method: 'POST' })
        } catch (err) {
          console.error('[TaskHistoryPanel] 取消失败:', err)
        } finally {
          setCancelling(false)
        }
      },
    })
  }, [])

  // 抽屉打开时加载历史
  useEffect(() => {
    if (open) void loadHistory()
  }, [open, loadHistory])

  // 锁释放后（任务结束）刷新历史，让行从"进行中"变为历史记录
  useEffect(() => {
    if (open && !activeLock) {
      void loadHistory()
    }
  }, [open, activeLock, loadHistory])

  const formatTime = (iso) => {
    if (!iso) return '-'
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return iso
    }
  }

  const formatResult = (entry) => {
    if (entry.status === 'failed') {
      return entry.error || '失败'
    }
    if (entry.status === 'cancelled') {
      const s = entry.summary
      const parts = ['已取消']
      if (s?.total != null) parts.push(`共 ${s.total} 条`)
      return parts.join(' · ')
    }
    const s = entry.summary
    if (!s) return '完成'
    const parts = []
    if (s.total != null) parts.push(`共 ${s.total} 条`)
    const stats = s.stats
    if (stats) {
      if (stats.ticketLlmCompleted != null) parts.push(`LLM 完成 ${stats.ticketLlmCompleted}`)
      if (stats.ticketLlmFailed) parts.push(`失败 ${stats.ticketLlmFailed}`)
      if (stats.afterUnknown != null) parts.push(`未识别旅程 ${stats.afterUnknown}`)
    }
    if (s.warnings) parts.push(`警告 ${s.warnings}`)
    return parts.length ? parts.join(' · ') : '完成'
  }

  // 构造表格数据：进行中任务在顶部，历史任务在下
  const dataSource = []
  if (activeLock) {
    dataSource.push({
      key: `active-${activeLock.id}`,
      id: activeLock.id,
      source: backgroundTaskTypeLabel(activeLock.type),
      startedAt: activeLock.startedAt,
      endedAt: '-',
      status: 'in_progress',
      result: activeLock.progress || '进行中…',
      username: activeLock.username,
    })
  }
  for (const entry of history) {
    dataSource.push({
      key: entry.id,
      id: entry.id,
      source: entry.source || backgroundTaskTypeLabel(entry.type),
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      status: entry.status,
      result: formatResult(entry),
      username: entry.username,
    })
  }

  const columns = [
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 110,
      render: (text, record) => {
        const color =
          record.status === 'in_progress'
            ? 'processing'
            : record.status === 'success'
              ? 'success'
              : record.status === 'cancelled'
                ? 'warning'
                : 'error'
        return <Tag color={color}>{text}</Tag>
      },
    },
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 135,
      render: formatTime,
    },
    {
      title: '结束时间',
      dataIndex: 'endedAt',
      key: 'endedAt',
      width: 135,
      render: formatTime,
    },
    {
      title: '执行结果',
      dataIndex: 'result',
      key: 'result',
      ellipsis: true,
      render: (text, record) => (
        <Space>
          <Tooltip title={text}>
            <span>{text}</span>
          </Tooltip>
          {record.status === 'in_progress' && (
            <Tooltip title="取消任务（已处理的记录不会写盘）">
              <Button
                size="small"
                type="link"
                danger
                icon={<StopOutlined />}
                loading={cancelling}
                onClick={handleCancel}
                className="!px-1 !h-auto"
              >
                取消
              </Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '操作人',
      dataIndex: 'username',
      key: 'username',
      width: 80,
    },
  ]

  return (
    <Drawer
      title="打标任务"
      open={open}
      onClose={onClose}
      width={760}
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void loadHistory()}
          loading={loading}
          size="small"
        >
          刷新
        </Button>
      }
    >
      <Table
        columns={columns}
        dataSource={dataSource}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        size="small"
        loading={loading}
        scroll={{ x: 520 }}
        locale={{ emptyText: '暂无打标任务记录' }}
      />
    </Drawer>
  )
}
