import { useCallback, useEffect, useState } from 'react'
import { Drawer, Table, Tag, Button, Tooltip, Modal } from 'antd'
import { ReloadOutlined, StopOutlined } from '@ant-design/icons'
import { apiFetch } from '../lib/apiClient.js'
import { cancelBackgroundTask } from '../lib/backgroundTaskClient.js'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { backgroundTaskTypeLabel } from '../domain/backgroundTaskLock.js'

/**
 * @typedef {Object} TaskHistoryEntry
 * @property {string} id
 * @property {string} type
 * @property {string} source
 * @property {string} [scope]
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {'success' | 'failed' | 'cancelled'} status
 * @property {Record<string, unknown>} [summary]
 * @property {string} [error]
 * @property {string} [username]
 */

/**
 * @param {{ open: boolean; onClose: () => void }} props
 */
export default function TaskHistoryPanel({ open, onClose }) {
  const { sharedBackgroundTasks, refreshSharedBackgroundTask } = useInsights()
  const message = useAppMessage()
  const [history, setHistory] = useState(/** @type {TaskHistoryEntry[]} */ ([]))
  const [loading, setLoading] = useState(false)
  const [cancellingId, setCancellingId] = useState('')

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

  const handleCancel = useCallback((taskId) => {
    Modal.confirm({
      title: '确认取消任务',
      content: '确定取消这个任务吗？导入取消后不会写盘；批量重打标会保留已经写盘的批次。',
      okText: '取消任务',
      okType: 'danger',
      cancelText: '不取消',
      onOk: async () => {
        setCancellingId(taskId)
        try {
          const res = await cancelBackgroundTask(taskId)
          await refreshSharedBackgroundTask()
          if (res?.finalized) {
            message.success(res.message || '任务已取消')
          } else {
            message.success(res?.message || '已发送取消请求，任务将尽快停止')
          }
          void loadHistory()
        } catch (err) {
          console.error('[TaskHistoryPanel] 取消失败:', err)
          message.error(err instanceof Error ? err.message : '取消失败')
        } finally {
          setCancellingId('')
        }
      },
    })
  }, [loadHistory, message, refreshSharedBackgroundTask])

  const activeTaskIds = (sharedBackgroundTasks || []).map((task) => task.id).join(',')
  // 打开抽屉，或进行中任务集合变化时刷新历史
  useEffect(() => {
    if (open) void loadHistory()
  }, [open, activeTaskIds, loadHistory])

  const formatTime = (iso) => {
    if (!iso || iso === '-') return '-'
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
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
  if (sharedBackgroundTasks?.length) {
    for (const activeLock of sharedBackgroundTasks) {
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
      render: (text) => (
        <Tooltip title={text}>
          <span>{text}</span>
        </Tooltip>
      ),
    },
    {
      title: '操作人',
      dataIndex: 'username',
      key: 'username',
      width: 80,
    },
    {
      title: '操作',
      key: 'action',
      width: 72,
      render: (_, record) => {
        if (record.status !== 'in_progress') return null
        return (
          <Button
            size="small"
            type="link"
            danger
            icon={<StopOutlined />}
            loading={cancellingId === record.id}
            onClick={() => handleCancel(record.id)}
            className="!px-0 !h-auto"
          >
            取消
          </Button>
        )
      },
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
        scroll={{ x: 640 }}
        locale={{ emptyText: '暂无打标任务记录' }}
      />
    </Drawer>
  )
}
