import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Popconfirm, Space, Spin, Tag, Typography, Upload } from 'antd'
import { DeleteOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { PageHeader } from './Dashboard.shared.jsx'
import TopicBriefView from '../components/topicAnalysis/TopicBriefView.jsx'
import FeedbackDrawer from '../components/FeedbackDrawer.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useFeedbacks } from '../context/FeedbackContext.jsx'
import { useAppMessage } from '../hooks/useAppMessage.js'
import {
  SUPPLEMENT_ACCEPT,
  TOPIC_ANALYSIS_DEMO_LABEL,
  TOPIC_ORIGIN_LABELS,
  TOPIC_TYPE_LABELS,
  topicReportStatus,
} from '../lib/topicAnalysis/constants.js'
import { topicRequestErrorMessage } from '../lib/topicAnalysis/customTopic.js'
import { isTopicReportJobRunning, runTopicReportJob } from '../lib/topicAnalysis/generateJob.js'
import { parseTopicSupplementFile } from '../lib/topicAnalysis/parseSupplement.js'
import {
  canDeleteTopicReport,
  topicActorFromUser,
  topicReportCreatedByLabel,
  topicReportUpdatedByLabel,
} from '../lib/topicAnalysis/reportActors.js'
import { deleteTopicReport, getTopicReport, saveTopicReport } from '../lib/topicAnalysis/store.js'

export default function TopicReportDetail() {
  const { reportId } = useParams()
  const navigate = useNavigate()
  const { adapter, settings, storageReady } = useInsights()
  const { feedbacks } = useFeedbacks()
  const { user } = useAuth()
  const message = useAppMessage()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedFeedback, setSelectedFeedback] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const status = topicReportStatus(report)

  const reload = useCallback(async () => {
    if (!adapter || !storageReady || !reportId) return
    setLoading(true)
    try {
      const next = await getTopicReport(adapter, reportId)
      setReport(next)
    } catch (err) {
      message.error(topicRequestErrorMessage(err, '加载报告失败'))
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [adapter, message, reportId, storageReady])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!adapter || !storageReady || !reportId || status !== 'generating') return undefined
    let cancelled = false
    void (async () => {
      const current = await getTopicReport(adapter, reportId)
      if (!current || cancelled || isTopicReportJobRunning(current.id)) return
      const next = await runTopicReportJob({ adapter, settings, report: current })
      if (!cancelled && next) setReport(next)
    })()
    const timer = setInterval(() => {
      void getTopicReport(adapter, reportId).then((next) => {
        if (!cancelled && next) setReport(next)
      })
    }, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [adapter, reportId, settings, status, storageReady])

  const queueRegenerate = useCallback(async (supplements, extras = {}) => {
    if (!adapter || !report?.topic) return
    const next = {
      ...report,
      supplements,
      status: 'generating',
      error: '',
      updatedAt: new Date().toISOString(),
      ...extras,
    }
    await saveTopicReport(adapter, next)
    setReport(next)
    message.info('报告生成中')
  }, [adapter, message, report])

  const handleImport = useCallback(async (file) => {
    try {
      const supplement = await parseTopicSupplementFile(file, file.name)
      const next = [...(report?.supplements || report?.brief?.supplements || []), supplement]
      await queueRegenerate(next, { updatedBy: topicActorFromUser(user) })
      message.success(`已加入 ${file.name}，正在后台更新分析`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '读取补充材料失败')
    }
    return false
  }, [message, queueRegenerate, report, user])

  const openTicket = useCallback((reference) => {
    const key = String(reference || '')
    const record = feedbacks.find((item) => String(item.id) === key || String(item.ticketId) === key || String(item.originalTicketId) === key)
    if (record) setSelectedFeedback(record)
    else message.warning('未找到该工单记录')
  }, [feedbacks, message])

  const handleDelete = useCallback(async () => {
    if (!adapter || !report || !canDeleteTopicReport(report, user)) {
      message.warning('无权删除该报告')
      return
    }
    setDeleting(true)
    try {
      await deleteTopicReport(adapter, report.id)
      message.success('已删除专题报告')
      navigate('/topics?tab=reports', { replace: true })
    } catch (err) {
      message.error(topicRequestErrorMessage(err, '删除失败'))
    } finally {
      setDeleting(false)
    }
  }, [adapter, message, navigate, report, user])

  if (loading) return <Spin className="py-12" />
  if (!report) {
    return (
      <div className="space-y-3">
        <Typography.Text>未找到该专题报告。</Typography.Text>
        <div><Link to="/topics?tab=reports">返回专题报告</Link></div>
      </div>
    )
  }

  const generating = status === 'generating'
  const failed = status === 'failed'
  const canDelete = canDeleteTopicReport(report, user)

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span>
            {report.title}
            <Tag color="orange" className="ml-2 align-middle">{TOPIC_ANALYSIS_DEMO_LABEL}</Tag>
            {generating ? <Tag color="processing" className="ml-2 align-middle">生成中</Tag> : null}
            {failed ? <Tag color="error" className="ml-2 align-middle">生成失败</Tag> : null}
          </span>
        }
        desc={[
          TOPIC_TYPE_LABELS[report.type] || report.type,
          TOPIC_ORIGIN_LABELS[report.origin] || '',
          report.period?.label || '',
          topicReportCreatedByLabel(report, user),
          topicReportUpdatedByLabel(report, user),
        ].filter(Boolean).join(' · ')}
        action={(
          <Space wrap>
            <Link to="/topics?tab=reports">返回列表</Link>
            <Upload accept={SUPPLEMENT_ACCEPT} showUploadList={false} disabled={generating || deleting} beforeUpload={handleImport}>
              <Button icon={<UploadOutlined />} disabled={generating || deleting}>提供补充材料</Button>
            </Upload>
            <Button
              icon={<ReloadOutlined />}
              disabled={generating || deleting}
              onClick={() => void queueRegenerate(report.supplements || report.brief?.supplements || [])}
            >
              {failed ? '重新生成' : '按系统数据重算'}
            </Button>
            {canDelete ? (
              <Popconfirm
                title="确定删除该专题报告？"
                description="删除后无法恢复。"
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={() => void handleDelete()}
              >
                <Button danger icon={<DeleteOutlined />} loading={deleting}>
                  删除
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        )}
      />
      {generating ? (
        <div className="py-12 text-center">
          <Spin tip="正在后台生成报告…" />
          <p className="mt-4 text-sm text-ink-500">可以返回列表继续做别的事，生成完成后会自动更新。</p>
        </div>
      ) : failed ? (
        <Alert
          type="error"
          showIcon
          message="生成失败"
          description={report.error || '请稍后重试'}
          action={<Button onClick={() => void queueRegenerate(report.supplements || [])}>重新生成</Button>}
        />
      ) : (
        <TopicBriefView brief={report.brief} onTicketClick={openTicket} />
      )}
      <FeedbackDrawer feedback={selectedFeedback} onClose={() => setSelectedFeedback(null)} />
    </div>
  )
}
