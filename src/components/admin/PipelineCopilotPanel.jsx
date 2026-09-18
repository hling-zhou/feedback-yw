import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Radio, Space, Spin, Tag, Typography } from 'antd'
import { PlayCircleOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { apiFetch } from '../../lib/apiClient.js'

const { Title, Text, Paragraph } = Typography

function StatusTag({ status }) {
  const map = {
    idle: { color: 'default', text: '未运行' },
    running: { color: 'processing', text: '运行中' },
    succeeded: { color: 'success', text: '成功' },
    failed: { color: 'error', text: '失败' } }
  const cfg = map[status] || map.idle
  return <Tag color={cfg.color}>{cfg.text}</Tag>
}

function GateStatusTag({ status }) {
  const map = {
    pass: { color: 'success', text: '通过' },
    fail: { color: 'error', text: '未通过' },
    skipped: { color: 'default', text: '跳过' } }
  const cfg = map[status] || map.skipped
  return <Tag color={cfg.color}>{cfg.text}</Tag>
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

/**
 * @param {{ summary: any }} props
 */
function SummaryDisplay({ summary }) {
  if (!summary) return <Text type="secondary">无摘要数据</Text>

  const gate = summary.gate || {}
  const config = summary.config || {}

  return (
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="状态">
        <Tag color={summary.status === 'pass' ? 'success' : 'error'}>
          {summary.status === 'pass' ? '通过' : '未通过'}
        </Tag>
      </Descriptions.Item>
      <Descriptions.Item label="耗时">{summary.durationSec ? `${summary.durationSec}s` : '—'}</Descriptions.Item>
      <Descriptions.Item label="工单数">{summary.evidenceRowsCount ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="新词发现">{summary.newWordCount ?? 0} 个</Descriptions.Item>
      <Descriptions.Item label="门禁状态">
        <GateStatusTag status={gate.status} />
      </Descriptions.Item>
      <Descriptions.Item label="门禁明细">
        {gate.passCount ?? 0} PASS / {gate.failCount ?? 0} FAIL
      </Descriptions.Item>
      <Descriptions.Item label="数据范围">{config.batch || '默认'}</Descriptions.Item>
      <Descriptions.Item label="产品范围">{config.products || 'curated only'}</Descriptions.Item>
    </Descriptions>
  )
}

export default function PipelineCopilotPanel({ canEdit }) {
  const message = useAppMessage()
  const [job, setJob] = useState(/** @type {any} */ (null))
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [batchMode, setBatchMode] = useState('*')
  const pollRef = useRef(/** @type {any} */ (null))

  const pollStatus = useCallback(async () => {
    try {
      const data = await apiFetch('/api/storage/pipeline/status')
      setJob(data)
      if (data.status === 'running') {
        setRunning(true)
        pollRef.current = setTimeout(pollStatus, 2000)
      } else {
        setRunning(false)
      }
    } catch {
      setRunning(false)
    }
  }, [])

  useEffect(() => {
    void pollStatus()
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [pollStatus])

  const handleRun = async () => {
    setRunning(true)
    setLoading(true)
    try {
      await apiFetch('/api/storage/pipeline/run', {
        method: 'POST',
        body: JSON.stringify({ batch: batchMode, products: '*' }) })
      message.success('流水线已启动')
      setTimeout(pollStatus, 1000)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '启动失败')
      setRunning(false)
    } finally {
      setLoading(false)
    }
  }

  const isRunning = running || job?.status === 'running'

  return (
    <div className="page-card"><div className="page-card-header"><span className="page-card-title">
        <Space>
          <Title level={5} style={{ margin: 0 }}>行动建议规则补充</Title>
          <StatusTag status={job?.status || 'idle'} />
        </Space>
      </span><div>
        <Space>
          <Radio.Group value={batchMode} onChange={(e) => setBatchMode(e.target.value)} disabled={isRunning || !canEdit}>
            <Radio.Button value="*">全量</Radio.Button>
            <Radio.Button value="">本期</Radio.Button>
          </Radio.Group>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={loading || isRunning}
            disabled={!canEdit}
            onClick={handleRun}
          >
            运行流水线
          </Button>
          <Button icon={<ReloadOutlined />} onClick={pollStatus} disabled={isRunning}>
            刷新
          </Button>
        </Space>
      </div></div>
      {isRunning && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large">
            <div style={{ padding: 20 }}>正在运行 Producer → keyword-discovery → --apply → gate-check...</div>
          </Spin>
        </div>
      )}

      {!isRunning && job?.status === 'succeeded' && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginBottom: 16 }}
          message="流水线运行完成"
          description={`由 ${job.triggeredBy || 'unknown'} 于 ${formatDateTime(job.startedAt)} 启动`}
        />
      )}

      {!isRunning && job?.status === 'failed' && (
        <Alert
          type="error"
          showIcon
          icon={<CloseCircleOutlined />}
          style={{ marginBottom: 16 }}
          message="流水线运行失败"
          description={`exit code: ${job.exitCode ?? 'unknown'}`}
        />
      )}

      {!isRunning && job?.summary && <SummaryDisplay summary={job.summary} />}

      {!isRunning && !job?.summary && job?.status !== 'idle' && job?.logTail && (
        <details>
          <summary style={{ cursor: 'pointer', marginBottom: 8 }}>查看日志尾部</summary>
          <pre style={{ maxHeight: 300, overflow: 'auto', background: '#f5f5f5', padding: 12, fontSize: 12, borderRadius: 6 }}>
            {job.logTail}
          </pre>
        </details>
      )}

      {!isRunning && (!job || job.status === 'idle') && (
        <Paragraph type="secondary">
          点击「运行流水线」执行行动建议规则补充：Producer 生成 evidence-rows → keyword-discovery 发现新词 → --apply 写入 overrides → gate-check 门禁验证。
          运行完成后结果将显示在下方。
        </Paragraph>
      )}

      {job?.summary?.gate?.failCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          message={`门禁 ${job.summary.gate.failCount} 项未通过`}
          description="回滚方案：删除 scripts/taxonomy-overrides.json 回到纯基线状态"
        />
      )}
    </div>
  )
}
