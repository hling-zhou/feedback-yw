import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { PageHeader } from './Dashboard.shared.jsx'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import TopicRecommendPanel from '../components/topicAnalysis/TopicRecommendPanel.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { isLlmAvailable } from '../lib/llmClient.js'
import { listActionItems } from '../lib/actionItemClient.js'
import {
  TOPIC_ANALYSIS_DEMO_LABEL,
  TOPIC_ANALYSIS_DEMO_NOTE,
  TOPIC_ORIGIN_LABELS,
  TOPIC_REPORT_STATUS_LABELS,
  TOPIC_TYPE_LABELS,
  TOPIC_TYPES,
  topicReportStatus,
} from '../lib/topicAnalysis/constants.js'
import { polishRecommendationsWithLlm } from '../lib/topicAnalysis/llmRecommend.js'
import {
  applyUnresolvedOverlay,
  recommendTopics,
  topicFromUserQuery,
  topRecommendCards,
} from '../lib/topicAnalysis/recommendTopics.js'
import {
  buildRecommendCacheKey,
  loadRecommendCache,
  recommendCacheMatches,
  saveRecommendCache,
} from '../lib/topicAnalysis/recommendCache.js'
import {
  customTopicQueryHint,
  customTopicTypeMismatch,
  parseTopicLabelList,
  topicForPersist,
  topicLabelListFromInput,
  topicLabelListToInput,
  topicRequestErrorMessage,
} from '../lib/topicAnalysis/customTopic.js'
import { interpretCustomTopic, applyInterpretationToTopic } from '../lib/topicAnalysis/interpretTopic.js'
import {
  canDeleteTopicReport,
  isOwnTopicActor,
  sortTopicReportsForViewer,
  topicActorFromUser,
  topicReportCreatedByLabel,
  topicReportUpdatedByLabel,
} from '../lib/topicAnalysis/reportActors.js'
import { isTopicReportJobRunning, runTopicReportJob } from '../lib/topicAnalysis/generateJob.js'
import {
  createTopicReport,
  deleteTopicReport,
  findReportByRecommendationId,
  loadTopicReports,
  mergeTopicReports,
  saveTopicReport,
} from '../lib/topicAnalysis/store.js'
import {
  buildRollingMonthPeriod,
  loadRecordsForTopicPeriod,
  periodFromSnapshot,
  snapshotPeriod,
} from '../lib/topicAnalysis/period.js'

export default function TopicAnalysis() {
  const { adapter, settings, storageReady } = useInsights()
  const { user } = useAuth()
  const actor = topicActorFromUser(user)
  const message = useAppMessage()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'reports' ? 'reports' : 'recommend'

  const rollingPeriod = useMemo(() => buildRollingMonthPeriod(), [])
  const [records, setRecords] = useState([])
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [reports, setReports] = useState([])
  const [reportsLoading, setReportsLoading] = useState(true)
  const recordsRef = useRef([])
  recordsRef.current = records
  const [typeFilter, setTypeFilter] = useState('all')
  const [adoptingId, setAdoptingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [customType, setCustomType] = useState('common_issue')
  const [customQuery, setCustomQuery] = useState('')
  const [customPeriod, setCustomPeriod] = useState(() => rollingPeriod)
  const [createStep, setCreateStep] = useState('input')
  const [interpreting, setInterpreting] = useState(false)
  const [interpretation, setInterpretation] = useState(null)
  const [cards, setCards] = useState([])
  const [llmPolishing, setLlmPolishing] = useState(false)
  const [llmPolished, setLlmPolished] = useState(false)

  useEffect(() => {
    if (!adapter || !storageReady) return undefined
    let cancelled = false
    setReportsLoading(true)
    void loadTopicReports(adapter).then((next) => {
      if (cancelled) return
      setReports((prev) => mergeTopicReports(next, prev))
    }).catch((err) => {
      if (!cancelled) message.error(topicRequestErrorMessage(err, '专题报告加载失败'))
    }).finally(() => {
      if (!cancelled) setReportsLoading(false)
    })
    return () => { cancelled = true }
  }, [adapter, storageReady, message])

  useEffect(() => {
    if (!adapter || !storageReady) return undefined
    let cancelled = false
    setRecordsLoading(true)
    setLlmPolishing(false)
    setLlmPolished(false)

    const toMonth = rollingPeriod.customToMonth || rollingPeriod.endDate?.slice(0, 7) || ''
    const periodLabel = rollingPeriod.label

    const overlayAndSet = (nextCards, items) => {
      setCards(applyUnresolvedOverlay(topRecommendCards(nextCards), items))
    }

    void (async () => {
      try {
        const [actionResult, revision, cached] = await Promise.all([
          listActionItems({ statuses: 'pending_evaluation,in_progress,suspended', limit: 80 }).catch(() => ({ items: [] })),
          typeof adapter.getDataRevision === 'function'
            ? adapter.getDataRevision().catch(() => ({ recordsRevision: 0 }))
            : Promise.resolve({ recordsRevision: 0 }),
          loadRecommendCache(adapter).catch(() => null),
        ])
        if (cancelled) return
        const items = actionResult?.items || []
        const key = buildRecommendCacheKey({
          recordsRevision: revision?.recordsRevision,
          toMonth,
        })
        if (recommendCacheMatches(cached, key)) {
          setRecords([])
          overlayAndSet(cached.cards, items)
          setLlmPolished(Boolean(cached.llmPolished))
          setLlmPolishing(false)
          setRecordsLoading(false)
          return
        }

        const nextRecords = await loadRecordsForTopicPeriod(adapter, rollingPeriod)
        if (cancelled) return
        setRecords(nextRecords)
        const candidates = recommendTopics({
          records: nextRecords,
          actionItems: [],
          periodLabel,
          toMonth,
        })
        overlayAndSet(candidates, items)
        setRecordsLoading(false)

        let polished = topRecommendCards(candidates)
        let didLlm = false
        if (candidates.length && isLlmAvailable(settings)) {
          setLlmPolishing(true)
          try {
            const next = await polishRecommendationsWithLlm(candidates, settings)
            if (!cancelled && next?.length) {
              polished = next
              didLlm = true
              overlayAndSet(next, items)
              setLlmPolished(true)
            }
          } catch {
            /* 保留规则卡 */
          }
          if (!cancelled) setLlmPolishing(false)
        }

        if (!cancelled) {
          await saveRecommendCache(adapter, {
            key,
            recordsRevision: revision?.recordsRevision,
            toMonth,
            llmPolished: didLlm,
            cards: polished,
          }).catch(() => {})
        }
      } catch (err) {
        if (cancelled) return
        setRecords([])
        setCards([])
        message.error(topicRequestErrorMessage(err, '专题推荐数据加载失败'))
        setRecordsLoading(false)
        setLlmPolishing(false)
      }
    })()

    return () => { cancelled = true }
  }, [adapter, storageReady, rollingPeriod, settings, message])

  const generatingKey = reports
    .filter((item) => topicReportStatus(item) === 'generating')
    .map((item) => item.id)
    .join(',')

  const visibleReports = useMemo(
    () => sortTopicReportsForViewer(reports, user),
    [reports, user],
  )

  useEffect(() => {
    if (!adapter || !storageReady || !generatingKey) return undefined
    let cancelled = false
    const startJobs = (list) => {
      for (const report of list) {
        if (topicReportStatus(report) !== 'generating' || isTopicReportJobRunning(report.id)) continue
        void runTopicReportJob({
          adapter,
          settings,
          report,
          records: report.origin === 'recommended' ? recordsRef.current : undefined,
        }).then((next) => {
          if (!next?.id || cancelled) return
          setReports((prev) => mergeTopicReports([next], prev))
          if (next.status === 'failed' && next.error) message.error(next.error)
        })
      }
    }
    void loadTopicReports(adapter).then((list) => {
      if (cancelled || !Array.isArray(list)) return
      setReports((prev) => mergeTopicReports(list, prev))
      startJobs(list)
    })
    const timer = setInterval(() => {
      void loadTopicReports(adapter).then((next) => {
        if (cancelled || !Array.isArray(next)) return
        setReports((prev) => mergeTopicReports(next, prev))
      })
    }, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [adapter, generatingKey, message, settings, storageReady])

  const enqueueReportJob = useCallback(async (report) => {
    const queued = { ...report, status: 'generating', brief: report.brief || null, error: '' }
    const list = await saveTopicReport(adapter, queued)
    setReports((prev) => mergeTopicReports(list, prev))
    setSearchParams({ tab: 'reports' }, { replace: true })
    message.info('报告生成中，可在「专题报告」查看进度')
    return queued
  }, [adapter, message, setSearchParams])

  const handleAdopt = useCallback(async (card) => {
    const existing = findReportByRecommendationId(reports, card.id)
      || (card.mergeIds || []).map((id) => findReportByRecommendationId(reports, id)).find(Boolean)
    if (existing) {
      if (topicReportStatus(existing) === 'generating') {
        setSearchParams({ tab: 'reports' }, { replace: true })
        message.info('该专题正在生成中')
        return
      }
      navigate(`/topics/${existing.id}`)
      return
    }
    setAdoptingId(card.id)
    try {
      const period = snapshotPeriod(rollingPeriod)
      await enqueueReportJob(createTopicReport({
        title: card.title,
        type: card.type,
        origin: 'recommended',
        period,
        topic: topicForPersist(card),
        brief: null,
        supplements: [],
        sourceRecommendationId: card.id,
        status: 'generating',
        createdBy: actor,
      }))
    } catch (err) {
      message.error(topicRequestErrorMessage(err, '纳入分析失败'))
    } finally {
      setAdoptingId(null)
    }
  }, [actor, enqueueReportJob, message, navigate, reports, rollingPeriod, setSearchParams])

  const handleDeleteReport = useCallback(async (report) => {
    if (!adapter || !canDeleteTopicReport(report, user)) {
      message.warning('无权删除该报告')
      return
    }
    setDeletingId(report.id)
    try {
      const list = await deleteTopicReport(adapter, report.id)
      setReports(list)
      message.success('已删除专题报告')
    } catch (err) {
      message.error(topicRequestErrorMessage(err, '删除失败'))
    } finally {
      setDeletingId(null)
    }
  }, [adapter, message, user])

  const handleCreate = useCallback(async () => {
    if (!interpretation) {
      message.warning('请先理解并确认范围')
      return
    }
    const topic = applyInterpretationToTopic(
      topicFromUserQuery(customQuery, { type: customType }),
      {
        ...interpretation,
        products: parseTopicLabelList(interpretation.products),
        keywords: parseTopicLabelList(interpretation.keywords),
      },
    )
    if (!topic) {
      message.warning('请输入专题名称或关键词')
      return
    }
    if (customType === 'customer' && !String(interpretation.customerName || '').trim() && !String(interpretation.customerCode || '').trim()) {
      message.warning('请确认客户名称或集团客户编码')
      return
    }
    if (!customPeriod) {
      message.warning('请指定分析周期')
      return
    }
    setCreating(true)
    try {
      await enqueueReportJob(createTopicReport({
        title: topic.title,
        type: topic.type,
        origin: 'custom',
        period: snapshotPeriod(customPeriod),
        topic: topicForPersist(topic),
        brief: null,
        supplements: [],
        status: 'generating',
        createdBy: actor,
      }))
      setCreateOpen(false)
      setCustomQuery('')
      setCreateStep('input')
      setInterpretation(null)
    } catch (err) {
      message.error(topicRequestErrorMessage(err, '新建专题失败'))
    } finally {
      setCreating(false)
    }
  }, [actor, customPeriod, customQuery, customType, enqueueReportJob, interpretation, message])

  const openCreateModal = useCallback(() => {
    setCustomType('common_issue')
    setCustomQuery('')
    setCustomPeriod(rollingPeriod)
    setCreateStep('input')
    setInterpretation(null)
    setCreateOpen(true)
  }, [rollingPeriod])

  const handleInterpret = useCallback(async () => {
    const text = customQuery.trim()
    if (!text) {
      message.warning('请输入专题名称、关键词或一段描述')
      return
    }
    if (!customPeriod) {
      message.warning('请指定分析周期')
      return
    }
    setInterpreting(true)
    try {
      const next = await interpretCustomTopic({ query: text, type: customType, settings })
      setInterpretation(next)
      setCreateStep('confirm')
    } catch (err) {
      message.error(topicRequestErrorMessage(err, '理解专题失败'))
    } finally {
      setInterpreting(false)
    }
  }, [customPeriod, customQuery, customType, message, settings])

  const isCustomerTopic = customType === 'customer'

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span>
            专题分析
            <Tag color="orange" className="ml-2 align-middle">{TOPIC_ANALYSIS_DEMO_LABEL}</Tag>
          </span>
        }
        desc="系统推荐近 9 个月值得深入的专题；纳入或新建后，在专题报告中查看完整分析并可补充材料。"
        hint={TOPIC_ANALYSIS_DEMO_NOTE}
        action={tab === 'reports' ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            新建专题
          </Button>
        ) : null}
      />

      <Alert
        type="info"
        showIcon
        message="Beta 版"
        description={`系统推荐固定使用近 9 个月（${rollingPeriod.label}），按近期 4 个月与更早 5 个月对比。新建专题时才选择周期，不会改工作台的洞察周期。`}
      />

      <Tabs
        activeKey={tab}
        onChange={(value) => setSearchParams(value === 'reports' ? { tab: 'reports' } : {}, { replace: true })}
        items={[
          {
            key: 'recommend',
            label: '系统推荐专题',
            children: (
              <TopicRecommendPanel
                cards={cards}
                reports={reports}
                loading={recordsLoading}
                adoptingId={adoptingId}
                typeFilter={typeFilter}
                onTypeFilter={setTypeFilter}
                onAdopt={handleAdopt}
                llmPolishing={llmPolishing}
                llmPolished={llmPolished}
              />
            ),
          },
          {
            key: 'reports',
            label: `专题报告${visibleReports.length ? `（${visibleReports.length}）` : ''}`,
            children: reportsLoading && visibleReports.length === 0 ? (
              <div className="py-12 text-center"><Spin /></div>
            ) : visibleReports.length === 0 ? (
              <Empty
                description="还没有专题报告。可从系统推荐纳入，或新建一个专题。"
                extra={(
                  <Space>
                    <Button onClick={() => setSearchParams({}, { replace: true })}>查看系统推荐</Button>
                    <Button type="primary" onClick={openCreateModal}>新建专题</Button>
                  </Space>
                )}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleReports.map((report) => {
                  const status = topicReportStatus(report)
                  const createdLabel = topicReportCreatedByLabel(report, user)
                  const updatedLabel = topicReportUpdatedByLabel(report, user)
                  const mine = isOwnTopicActor(report.createdBy, user)
                  const canDelete = canDeleteTopicReport(report, user)
                  return (
                  <Card
                    key={report.id}
                    size="small"
                    title={report.title}
                    extra={(
                      <Space size={8}>
                        {canDelete ? (
                          <Popconfirm
                            title="确定删除该专题报告？"
                            description="删除后无法恢复。"
                            okText="删除"
                            okButtonProps={{ danger: true }}
                            cancelText="取消"
                            onConfirm={() => void handleDeleteReport(report)}
                          >
                            <Button
                              type="link"
                              size="small"
                              danger
                              className="!px-0"
                              icon={<DeleteOutlined />}
                              loading={deletingId === report.id}
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        ) : null}
                        <Link to={`/topics/${report.id}`}>{status === 'generating' ? '查看进度' : '进入详情'}</Link>
                      </Space>
                    )}
                  >
                    <Space wrap size={4}>
                      <Tag>{TOPIC_TYPE_LABELS[report.type] || report.type}</Tag>
                      <Tag>{TOPIC_ORIGIN_LABELS[report.origin] || report.origin}</Tag>
                      <Tag color={mine ? 'blue' : undefined}>{createdLabel}</Tag>
                      {status === 'generating' ? <Tag color="processing">{TOPIC_REPORT_STATUS_LABELS.generating}</Tag> : null}
                      {status === 'failed' ? <Tag color="error">{TOPIC_REPORT_STATUS_LABELS.failed}</Tag> : null}
                    </Space>
                    <p className="mt-2 text-xs text-ink-500">
                      {report.period?.label || '未指定周期'}
                      {' · '}
                      补充 {(report.supplements || report.brief?.supplements || []).length} 份
                      {updatedLabel ? ` · ${updatedLabel}` : ''}
                    </p>
                    {status === 'generating' ? (
                      <Typography.Text type="secondary" className="text-xs">正在后台生成…</Typography.Text>
                    ) : status === 'failed' ? (
                      <Typography.Text type="danger" className="text-xs">{report.error || '生成失败，可进入详情重试'}</Typography.Text>
                    ) : (
                      <Typography.Text type="secondary" className="text-xs">
                        更新于 {(report.updatedAt || '').slice(0, 16).replace('T', ' ')}
                      </Typography.Text>
                    )}
                  </Card>
                  )
                })}
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={createStep === 'confirm' ? '确认分析对象与范围' : '新建专题'}
        open={createOpen}
        width={640}
        onCancel={() => {
          setCreateOpen(false)
          setCreateStep('input')
          setInterpretation(null)
        }}
        destroyOnHidden
        footer={(
          <Space>
            {createStep === 'confirm' ? (
              <Button onClick={() => setCreateStep('input')}>返回修改</Button>
            ) : (
              <Button onClick={() => {
                setCreateOpen(false)
                setCreateStep('input')
                setInterpretation(null)
              }}
              >
                取消
              </Button>
            )}
            <Button
              type="primary"
              loading={creating || interpreting}
              onClick={() => {
                if (createStep === 'confirm') void handleCreate()
                else void handleInterpret()
              }}
            >
              {createStep === 'confirm' ? '确认并生成报告' : '理解并确认范围'}
            </Button>
          </Space>
        )}
      >
        {createStep === 'confirm' && interpretation ? (
          <div className="space-y-3">
            <Alert
              type="info"
              showIcon
              message={interpretation.source === 'llm' ? '以下是系统对这段话的理解，请核对后生成。' : '未调用大模型，以下为规则拆解，可直接改。'}
              description={interpretation.interpretation}
            />
            <p className="text-sm text-ink-600">{interpretation.scopeNote}</p>
            {(interpretation.questions || []).map((question) => (
              <Alert key={question} type="warning" showIcon message={question} />
            ))}
            <Form layout="vertical">
              <Form.Item label="报告标题">
                <Input
                  value={interpretation.title}
                  onChange={(event) => setInterpretation((prev) => ({ ...prev, title: event.target.value }))}
                />
              </Form.Item>
              {isCustomerTopic ? (
                <>
                  <Form.Item label="客户名称" extra="匹配按名称或集团客户编码精确匹配（编码优先）。">
                    <Input
                      value={interpretation.customerName || ''}
                      onChange={(event) => setInterpretation((prev) => ({ ...prev, customerName: event.target.value }))}
                      placeholder="例如 甲公司"
                    />
                  </Form.Item>
                  <Form.Item label="集团客户编码（可选）">
                    <Input
                      value={interpretation.customerCode || ''}
                      onChange={(event) => setInterpretation((prev) => ({ ...prev, customerCode: event.target.value }))}
                      placeholder="例如 C001"
                    />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Form.Item label="产品（可改，多个用顿号分隔）">
                    <Input
                      value={topicLabelListToInput(interpretation.products)}
                      onChange={(event) => setInterpretation((prev) => ({
                        ...prev,
                        products: topicLabelListFromInput(event.target.value),
                      }))}
                      placeholder="例如 弹性公网IP、云主机"
                    />
                  </Form.Item>
                  <Form.Item label="问题对象">
                    <Input
                      value={interpretation.problem}
                      onChange={(event) => setInterpretation((prev) => ({ ...prev, problem: event.target.value }))}
                    />
                  </Form.Item>
                  <Form.Item label="匹配关键词（可改，顿号分隔）" extra="生成报告时按这些词拆开匹配，不必在原文中连写。">
                    <Input
                      value={topicLabelListToInput(interpretation.keywords)}
                      onChange={(event) => setInterpretation((prev) => ({
                        ...prev,
                        keywords: topicLabelListFromInput(event.target.value),
                      }))}
                      placeholder="例如 安全组、配置不当"
                    />
                  </Form.Item>
                </>
              )}
            </Form>
          </div>
        ) : (
          <Form layout="vertical">
            <Form.Item label="专题类型" extra={customTopicQueryHint(customType)}>
              <Segmented
                block
                value={customType}
                onChange={(value) => {
                  setCustomType(value)
                  setCreateStep('input')
                  setInterpretation(null)
                }}
                options={TOPIC_TYPES.map((type) => ({ label: TOPIC_TYPE_LABELS[type], value: type }))}
              />
            </Form.Item>
            <Form.Item
              label="名称、关键词或一段描述"
              required
              validateStatus={customTopicTypeMismatch(customType, customQuery) ? 'warning' : undefined}
              help={customTopicTypeMismatch(customType, customQuery) || '可以写一段话，下一步会给出理解结果供你确认。'}
            >
              <Input.TextArea
                rows={4}
                placeholder={isCustomerTopic
                  ? '例如：甲公司最近投诉很多，想看看这家客户近几个月怎么了。也可只填名称或编码。'
                  : '例如：最近弹性公网IP晚上高峰带宽经常被限制，客户反复反馈，想看看是不是限速问题。'}
                value={customQuery}
                onChange={(event) => setCustomQuery(event.target.value)}
              />
            </Form.Item>
            <Form.Item label="分析周期" required extra="只作用于本专题，不会改工作台的洞察周期。">
              <InsightPeriodPicker
                compact
                showHint={false}
                value={customPeriod?.id || null}
                onChange={(_id, period) => setCustomPeriod(period || periodFromSnapshot(null))}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  )
}
