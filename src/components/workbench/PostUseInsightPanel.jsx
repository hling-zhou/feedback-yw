import { useMemo, useState } from 'react'
import { Alert, Button, Card, Space, Table, Tabs, Tag, Typography, message } from 'antd'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { buildPostUseInsightBundle } from '../../lib/postUseRating/insights.js'
import { qualityAnomaliesToCsv } from '../../lib/postUseRating/qualityStore.js'
import { recomputePostUseInsightBundle } from '../../lib/postUseRating/insightStore.js'

const stateColor = { healthy: 'green', watch: 'gold', critical: 'red', small_sample: 'default' }
const changeColor = { 新增: 'red', 增长: 'volcano', 持续: 'gold', 缓解: 'blue', 消失: 'green' }

function downloadCsv(text, name) {
  const blob = new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function PostUseInsightPanel({ records, allRecords, visits = [], quality, adapter, periodKey }) {
  const [recomputing, setRecomputing] = useState(false)
  const [revision, setRevision] = useState(0)
  const bundle = useMemo(() => buildPostUseInsightBundle(records, { visits }), [records, visits, revision])
  const changes = useMemo(() => buildPostUseInsightBundle(allRecords).issueChanges, [allRecords, revision])

  const recompute = async () => {
    if (!adapter) return
    setRecomputing(true)
    try {
      await recomputePostUseInsightBundle(adapter, periodKey, records, { visits })
      setRevision((v) => v + 1)
      message.success('已按当前产品目录和分析规则重算')
    } catch (error) {
      message.error(error?.message || '重算失败')
    } finally {
      setRecomputing(false)
    }
  }

  const productColumns = [
    { title: '产品', dataIndex: 'productName', fixed: 'left', width: 150 },
    { title: '体验状态', dataIndex: 'state', width: 105, render: (v, r) => <Tag color={stateColor[r.stateCode]}>{v}</Tag> },
    { title: '样本量', dataIndex: 'sampleSize', width: 82 },
    { title: '均分', dataIndex: 'avgScore', width: 76 },
    { title: '非10分', dataIndex: 'nonTenCount', width: 82 },
    { title: '回访证据', dataIndex: 'visitEvidenceCount', width: 88, render: (v) => v || '—' },
    { title: '判定依据', dataIndex: 'explanation' },
  ]
  const sceneColumns = [
    { title: '产品', dataIndex: 'productName', fixed: 'left', width: 150 },
    { title: '评价触发场景', dataIndex: 'originalScene', width: 170 },
    { title: '用户旅程', dataIndex: 'journey', width: 130 },
    { title: '样本量', dataIndex: 'sampleSize', width: 82 },
    { title: '均分', dataIndex: 'avgScore', width: 76 },
    { title: '非10分', dataIndex: 'nonTenCount', width: 82 },
  ]
  const needColumns = [
    { title: '改善优先级', dataIndex: 'priority', width: 104, render: (v) => <Tag color={v === 'P0' ? 'red' : v === 'P1' ? 'gold' : 'default'}>{v}</Tag> },
    { title: '产品', dataIndex: 'productName', width: 150 },
    { title: '用户需求/原因', dataIndex: 'need', width: 210 },
    { title: '反馈数', dataIndex: 'count', width: 82 },
    { title: '客户数', dataIndex: 'customerCount', width: 82 },
    { title: '回访证据', dataIndex: 'visitEvidenceCount', width: 88, render: (v) => v || '—' },
    { title: '改善优先分', dataIndex: 'priorityScore', width: 104 },
    { title: '可解释计算', dataIndex: 'explanation' },
  ]

  const qualityItems = quality ? [
    ['原始数据', quality.counts.raw], ['导入规则排除', quality.counts.rejected || 0], ['有效评分', quality.counts.validScored], ['去重记录', quality.counts.duplicate],
    ['分析范围内', quality.counts.analysisScoped], ['范围外', quality.counts.outOfScope], ['选项证据', quality.counts.optionEvidence],
    ['缺少评价场景', quality.counts.missingOriginalScene], ['未归类证据', quality.counts.uncategorizedEvidence],
  ] : []

  return (
    <Card
      size="small"
      title="产品体验与用户需求洞察"
      extra={<Button size="small" icon={<ReloadOutlined />} loading={recomputing} onClick={recompute}>重算当前周期</Button>}
    >
      <Tabs
        items={[
          { key: 'products', label: '产品体验', children: <Table size="small" rowKey="productName" scroll={{ x: 760 }} pagination={{ pageSize: 10 }} columns={productColumns} dataSource={bundle.products} /> },
          { key: 'scene', label: '场景与旅程', children: <><Alert className="mb-3" type="info" showIcon title="仅使用原始评价场景与现有用户旅程标签" description="评价触发场景来自短信问卷场景或官网一级场景；未提供与未识别环节单独披露。不会添加请求场景、问题类型或情绪标签。"/><Table size="small" rowKey={(r) => `${r.productName}-${r.originalScene}-${r.journey}`} scroll={{ x: 760 }} pagination={{ pageSize: 10 }} columns={sceneColumns} dataSource={bundle.sceneJourneys} /></> },
          { key: 'needs', label: '用户需求', children: <Table size="small" rowKey={(r) => `${r.productName}-${r.need}`} scroll={{ x: 900 }} pagination={{ pageSize: 10 }} columns={needColumns} dataSource={bundle.needs} /> },
          { key: 'customers', label: '客户洞察', children: <Table size="small" rowKey={(r) => r.customerCode || r.customerName} pagination={{ pageSize: 10 }} columns={[
            { title: '客户', dataIndex: 'customerName', width: 180 }, { title: '涉及产品', dataIndex: 'products', render: (v) => v.join('、') },
            { title: '非10分次数', dataIndex: 'nonTenCount', width: 100 }, { title: '均分', dataIndex: 'avgScore', width: 76, render: (v) => v == null ? '—' : v },
            { title: '关注', dataIndex: 'highFrequency', width: 90, render: (v) => v ? <Tag color="red">高频低分</Tag> : <Tag>单次</Tag> },
            { title: '最新原话', dataIndex: 'latestQuote', ellipsis: true },
            { title: '回访证据', dataIndex: 'visitEvidenceCount', width: 88, render: (v) => v || '—' },
            { title: '回访结论', dataIndex: 'visitConclusion', width: 180, ellipsis: true },
          ]} dataSource={bundle.customers} /> },
          { key: 'changes', label: '问题变化', children: <Table size="small" rowKey={(r) => `${r.productName}-${r.issue}`} pagination={{ pageSize: 10 }} columns={[
            { title: '变化', dataIndex: 'change', width: 82, render: (v) => <Tag color={changeColor[v]}>{v}</Tag> },
            { title: '产品', dataIndex: 'productName', width: 150 }, { title: '问题/需求', dataIndex: 'issue' },
            { title: '上期', dataIndex: 'previousCount', width: 76 }, { title: '本期', dataIndex: 'currentCount', width: 76 },
          ]} dataSource={changes} locale={{ emptyText: '至少需要两个数据月份才能判断变化' }} /> },
          { key: 'quality', label: '数据质量', children: quality ? <>
            <Space wrap className="mb-3">{qualityItems.map(([label, value]) => <Tag key={label}>{label}：{value}</Tag>)}</Space>
            <Typography.Paragraph type="secondary">产品目录 {quality.versions.catalog} · 分析规则 {quality.versions.analysisRule} · 原因规则 {quality.versions.reasonRule}</Typography.Paragraph>
            <Button icon={<DownloadOutlined />} disabled={!quality.anomalies?.length} onClick={() => downloadCsv(qualityAnomaliesToCsv(quality), `用后即评数据异常-${quality.importMonth}.csv`)}>下载异常明细</Button>
          </> : <Alert type="info" showIcon title="当前周期暂无质量快照" description="重新导入该月份双文件后会生成；历史数据仍可正常分析。"/> },
        ]}
      />
    </Card>
  )
}
