import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Collapse, Descriptions, Modal, Space, Table, Typography, Upload, message } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { buildMonthlyReportPreviewModel } from '../../lib/postUseRating/monthlyReportPreview.js'
import {
  buildMonthlyReportDocxBlob,
  triggerDocxDownload,
} from '../../lib/postUseRating/monthlyReportDocx.js'
import {
  analyzeMonthlyReportRevisionLearning,
  appendMonthlyReportRevision,
  importMonthlyReportDocx,
  loadMonthlyReportLearnings,
  loadMonthlyReportRevisions,
  upsertMonthlyReportLearnings,
} from '../../lib/postUseRating/monthlyReportDocxImport.js'

/**
 * 月报结构化预览 + docx 结构稿导出
 * @param {{
 *   reportMonth: string
 *   scoredRows: import('../../lib/postUseRating/parseChannels.js').NormalizedPostUseRow[]
 *   productNames: string[]
 *   visits?: object[]
 *   actionItems?: object[]
 *   reasons?: { reason: string; count: number; channel?: string }[]
 *   insightBundle?: object
 *   quality?: object
 *   storyModel?: object
 * }} props
 */
export default function PostUseMonthlyReportPreview(props) {
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importedRevision, setImportedRevision] = useState(null)
  const [revisionCount, setRevisionCount] = useState(0)
  const [learningLibrary, setLearningLibrary] = useState([])
  const importMountedRef = useRef(true)
  const model = useMemo(
    () =>
      buildMonthlyReportPreviewModel({
        reportMonth: props.reportMonth,
        scoredRows: props.scoredRows,
        productNames: props.productNames,
        visits: props.visits,
        actionItems: props.actionItems,
        reasons: props.reasons,
        insightBundle: props.insightBundle,
        quality: props.quality,
        storyModel: props.storyModel,
        learnings: learningLibrary,
      }),
    [props, learningLibrary],
  )

  useEffect(() => {
    importMountedRef.current = true
    return () => {
      importMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!props.adapter) return
      try {
        const [revisions, learnings] = await Promise.all([
          loadMonthlyReportRevisions(props.adapter),
          loadMonthlyReportLearnings(props.adapter),
        ])
        if (!cancelled) {
          setRevisionCount(revisions.length)
          setLearningLibrary(learnings)
        }
      } catch {
        if (!cancelled) {
          setRevisionCount(0)
          setLearningLibrary([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [props.adapter])

  const onExportDocx = async () => {
    setExporting(true)
    try {
      let exportModel = model
      if (props.adapter) {
        const latestLearnings = await loadMonthlyReportLearnings(props.adapter)
        if (importMountedRef.current) setLearningLibrary(latestLearnings)
        exportModel = buildMonthlyReportPreviewModel({
          reportMonth: props.reportMonth,
          scoredRows: props.scoredRows,
          productNames: props.productNames,
          visits: props.visits,
          actionItems: props.actionItems,
          reasons: props.reasons,
          insightBundle: props.insightBundle,
          quality: props.quality,
          storyModel: props.storyModel,
          learnings: latestLearnings,
        })
      }
      const blob = await buildMonthlyReportDocxBlob(exportModel)
      triggerDocxDownload(blob, `用后即评月报-${props.reportMonth}.docx`)
      message.success('已基于线上综合分析生成 Word 月报')
    } catch (e) {
      message.error(e?.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const handleImportRevision = async (file) => {
    setImporting(true)
    try {
      const revision = await importMonthlyReportDocx(file)
      const analysis = analyzeMonthlyReportRevisionLearning({
        currentModel: model,
        revision,
      })
      const enrichedRevision = {
        ...revision,
        comparison: analysis.comparison,
        learnedEntries: analysis.learnings,
      }
      if (props.adapter) {
        const [nextRevisions, nextLearnings] = await Promise.all([
          appendMonthlyReportRevision(props.adapter, enrichedRevision),
          upsertMonthlyReportLearnings(props.adapter, analysis.learnings),
        ])
        if (importMountedRef.current) {
          setRevisionCount(nextRevisions.length)
          setLearningLibrary(nextLearnings)
        }
      }
      if (!importMountedRef.current) return false
      setImportedRevision(enrichedRevision)
      setImportModalOpen(true)
      message.success('已导入修订版 Word')
    } catch (e) {
      message.error(e?.message || '导入修订版失败')
    } finally {
      if (importMountedRef.current) setImporting(false)
    }
    return false
  }

  if (!props.reportMonth || !props.scoredRows?.length) {
    return (
      <Alert
        type="info"
        showIcon
        title="导入当月渠道明细后，可从线上综合分析生成同口径 Word 月报"
      />
    )
  }

  return (
    <Card
      size="small"
      title={model.title}
      extra={
        <Space>
          <Upload
            accept=".docx"
            showUploadList={false}
            beforeUpload={(file) => handleImportRevision(file)}
          >
            <Button
              size="small"
              icon={<UploadOutlined />}
              loading={importing}
            >
              导入修订版
            </Button>
          </Upload>
          <Button
            type="primary"
            size="small"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={() => void onExportDocx()}
          >
            生成 Word 月报
          </Button>
        </Space>
      }
    >
      <Alert
        className="mb-3"
        type="info"
        showIcon
        title="线上综合分析 → Word 月报"
        description={
          <>
            {model.overview.note}
            <br />
            Word 固定输出当月概述、产品体验、场景旅程、用户需求、客户洞察、问题变化、举措与效果验证。
          </>
        }
      />
      {revisionCount ? (
        <Alert
          className="mb-3"
          type="success"
          showIcon
          message={`已导入 ${revisionCount} 份修订版 Word，可继续用于后续修订对比与能力迭代`}
        />
      ) : null}
      {learningLibrary.length ? (
        <Alert
          className="mb-3"
          type="info"
          showIcon
          message={`已沉淀 ${learningLibrary.length} 条修订经验`}
          description={
            <div className="space-y-1">
              {learningLibrary.slice(0, 3).map((item) => (
                <div key={item.id}>
                  <strong>{item.title}</strong>
                  <span className="text-ink-500"> · {item.recommendation}</span>
                </div>
              ))}
            </div>
          }
        />
      ) : null}
      {model.reviewChecklist?.length ? (
        <Card size="small" title="本次导出前建议复核" className="mb-3">
          <div className="space-y-3">
            {model.reviewChecklist.map((item) => (
              <div key={item.id || `${item.section}-${item.title}`}>
                <Typography.Text strong>{item.sectionLabel}</Typography.Text>
                <Typography.Text className="ml-2">{item.title}</Typography.Text>
                <Typography.Paragraph className="!mb-1 !mt-1 text-sm text-ink-700">
                  {item.recommendation}
                </Typography.Paragraph>
                <Typography.Text type="secondary" className="text-xs">
                  {item.summary || '基于历史修订自动沉淀的复核经验'}
                  {item.hitCount ? ` · 已命中 ${item.hitCount} 次` : ''}
                </Typography.Text>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      <Descriptions size="small" column={2} bordered className="mb-4">
        <Descriptions.Item label="云网产品数">{model.overview.productCount}</Descriptions.Item>
        <Descriptions.Item label="云网样本量">{model.overview.totalSample}</Descriptions.Item>
        <Descriptions.Item label="云网均分">{model.overview.avgScore}</Descriptions.Item>
        <Descriptions.Item label="9分以下">
          {model.overview.belowNineCount}（{model.overview.belowNineRatio}%）
        </Descriptions.Item>
        <Descriptions.Item label="公司均分">{model.overview.companyAvg}</Descriptions.Item>
        <Descriptions.Item label="公司样本量">{model.overview.companySample}</Descriptions.Item>
      </Descriptions>

      <Typography.Title level={5}>线上综合分析入报范围</Typography.Title>
      <Descriptions size="small" column={3} bordered className="mb-4">
        <Descriptions.Item label="产品体验">{model.productExperience.length} 个产品</Descriptions.Item>
        <Descriptions.Item label="场景×旅程">{model.sceneJourneys.length} 个组合</Descriptions.Item>
        <Descriptions.Item label="用户需求">{model.needs.length} 项</Descriptions.Item>
        <Descriptions.Item label="客户洞察">{model.customers.length} 个客户（含 {model.onlineModel?.visitEvidenceCount || 0} 条回访证据）</Descriptions.Item>
        <Descriptions.Item label="问题变化">{model.issueChanges.length} 项</Descriptions.Item>
        <Descriptions.Item label="分析规则">{model.onlineModel.ruleVersion || '—'}</Descriptions.Item>
      </Descriptions>

      <Typography.Title level={5}>投诉回访不达标（n≥10）</Typography.Title>
      <Table
        size="small"
        rowKey="productName"
        pagination={false}
        className="mb-4"
        dataSource={model.satisfaction.notQualified}
        columns={[
          { title: '产品', dataIndex: 'productName' },
          { title: '样本量', dataIndex: 'sampleSize', width: 88 },
          { title: '满意度', dataIndex: 'rate', width: 88, render: (v) => `${v}%` },
        ]}
        locale={{ emptyText: '无（或仅有小样本参考项）' }}
      />

      <Collapse
        className="mb-4"
        items={[
          {
            key: 'monthly-score-table',
            label: '整体得分情况',
            children: (
              <Table
                size="small"
                rowKey="productName"
                pagination={false}
                dataSource={model.monthlyScoreTable}
                columns={[
                  { title: '产品名', dataIndex: 'productName', width: 140 },
                  { title: '样本量', dataIndex: 'sampleSize', width: 88 },
                  { title: '得分', dataIndex: 'avgScore', width: 88 },
                  {
                    title: '投诉回访满意度-10分满意比',
                    dataIndex: 'callbackTenPointRate',
                    width: 180,
                    render: (value) => (value == null ? '/' : `${value}%`),
                  },
                ]}
                locale={{ emptyText: '暂无月报口径产品总表' }}
              />
            ),
          },
          {
            key: 'score-distribution',
            label: '整体分布',
            children: (
              <Table
                size="small"
                rowKey="productName"
                pagination={false}
                dataSource={model.scoreDistributionTable}
                columns={[
                  { title: '产品名', dataIndex: 'productName', width: 140 },
                  { title: '样本量', dataIndex: 'sampleSize', width: 88 },
                  ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((score) => ({
                    title: `${score}分`,
                    dataIndex: String(score),
                    width: 72,
                  })),
                ]}
                locale={{ emptyText: '当前范围内暂无需要展开分布的产品' }}
              />
            ),
          },
        ]}
      />

      <Typography.Title level={5}>选项类 / 低分原因 Top</Typography.Title>
      <Table
        size="small"
        rowKey={(r) => `${r.channel || ''}-${r.reason}`}
        pagination={false}
        className="mb-4"
        dataSource={(model.reasons || []).slice(0, 15)}
        columns={[
          ...(model.reasons?.some((r) => r.channel)
            ? [{ title: '渠道', dataIndex: 'channel', width: 88 }]
            : []),
          { title: '原因', dataIndex: 'reason' },
          { title: '次数', dataIndex: 'count', width: 88 },
        ]}
        locale={{ emptyText: '暂无（导入含选项类的双文件后写入趋势）' }}
      />

      <Typography.Title level={5}>客服回访（数据月份 {model.visitMonth}）</Typography.Title>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        className="mb-4"
        dataSource={model.visits}
        columns={[
          { title: '产品', dataIndex: 'productName', width: 120 },
          { title: '摘要', dataIndex: 'feedbackSummary', ellipsis: true },
          { title: '结论', dataIndex: 'internalConclusion', width: 160, ellipsis: true },
        ]}
        locale={{ emptyText: '本月暂无客服回访记录' }}
      />

      <Typography.Title level={5}>上期回访结果</Typography.Title>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        className="mb-4"
        dataSource={model.visitsDetailed}
        columns={[
          { title: '用户反馈', dataIndex: 'userFeedbackText', ellipsis: true, render: (value) => value || '—' },
          { title: '用户信息', dataIndex: 'userInfoDetail', width: 180, ellipsis: true, render: (value) => value || '—' },
          { title: '回访反馈信息', dataIndex: 'visitFeedbackDetail', ellipsis: true, render: (value) => value || '—' },
          { title: '回访反馈信息-内部评估', dataIndex: 'internalEvaluationDetail', ellipsis: true, render: (value) => value || '—' },
        ]}
        locale={{ emptyText: '本月暂无完整回访明细' }}
      />

      <Typography.Text type="secondary" className="text-xs">
        举措：本月提出 {model.actionsProposed?.length || 0} · 本月关闭{' '}
        {model.actionsClosed?.length || 0}（完整闭环见举措与进展）
      </Typography.Text>
      <Typography.Title level={5} className="!mt-4">洞察 → 举措 → 效果</Typography.Title>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={model.actionMappings}
        columns={[
          { title: '产品', dataIndex: 'productName', width: 120 },
          { title: '洞察主题', dataIndex: 'insightTheme', width: 180, ellipsis: true },
          { title: '举措', dataIndex: 'content', ellipsis: true },
          { title: '证据', dataIndex: 'evidenceCount', width: 72 },
          { title: '效果', dataIndex: 'recovery', width: 88 },
        ]}
        locale={{ emptyText: '本月暂无关联举措' }}
      />
      {model.completedButNotRecovered.length ? (
        <Alert className="mt-3" type="warning" showIcon title={`已完成但体验未恢复 ${model.completedButNotRecovered.length} 项`} description="建议重新打开分析并补充后续举措，不以“已完成”替代效果达成。" />
      ) : null}
      <Modal
        open={importModalOpen}
        title="修订版 Word 已导入"
        footer={[
          <Button key="close" type="primary" onClick={() => setImportModalOpen(false)}>
            知道了
          </Button>,
        ]}
        onCancel={() => setImportModalOpen(false)}
        width={760}
      >
        {importedRevision ? (
          <div className="space-y-3">
            <Alert
              type={
                importedRevision.reportMonth && props.reportMonth && importedRevision.reportMonth !== props.reportMonth
                  ? 'warning'
                  : 'success'
              }
              showIcon
              message={
                importedRevision.reportMonth && props.reportMonth && importedRevision.reportMonth !== props.reportMonth
                  ? `修订版月份为 ${importedRevision.reportMonth}，当前页面月份为 ${props.reportMonth}`
                  : '已识别系统模板修订版'
              }
              description="当前版本会保存修订稿、沉淀修订经验，并在后续 Word 预览与导出中给出复核提示。"
            />
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="差异总数">
                {importedRevision.comparison?.differenceCount ?? 0}
              </Descriptions.Item>
              <Descriptions.Item label="变更章节">
                {(importedRevision.comparison?.changedSections || []).map((item) => item.label).join('、') || '无'}
              </Descriptions.Item>
            </Descriptions>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="文件名">{importedRevision.fileName}</Descriptions.Item>
              <Descriptions.Item label="报告月份">{importedRevision.reportMonth || '未识别'}</Descriptions.Item>
              <Descriptions.Item label="2.1 整体得分情况">{importedRevision.summary.monthlyScoreRows} 行</Descriptions.Item>
              <Descriptions.Item label="2.3 整体分布">{importedRevision.summary.scoreDistributionRows} 行</Descriptions.Item>
              <Descriptions.Item label="上期回访结果">{importedRevision.summary.visitsDetailedRows} 行</Descriptions.Item>
              <Descriptions.Item label="导入时间">{importedRevision.importedAt}</Descriptions.Item>
            </Descriptions>
            {(importedRevision.learnedEntries || []).length ? (
              <Card size="small" title="学到的经验">
                <div className="space-y-3">
                  {importedRevision.learnedEntries.map((item) => (
                    <div key={item.id}>
                      <Typography.Text strong>{item.title}</Typography.Text>
                      <Typography.Paragraph className="!mb-1 !mt-1 text-sm">
                        {item.summary}
                      </Typography.Paragraph>
                      <Typography.Text type="secondary" className="text-xs">
                        {item.recommendation}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Alert
                type="info"
                showIcon
                message="未检测到结构化差异"
                description="当前修订版与系统月报的核心结构表一致，暂未沉淀新的修订经验。"
              />
            )}
          </div>
        ) : null}
      </Modal>
    </Card>
  )
}
