import { useMemo, useState } from 'react'
import { Alert, Button, Card, Descriptions, Table, Typography, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { buildMonthlyReportPreviewModel } from '../../lib/postUseRating/monthlyReportPreview.js'
import {
  buildMonthlyReportDocxBlob,
  triggerDocxDownload,
} from '../../lib/postUseRating/monthlyReportDocx.js'

/**
 * 月报结构化预览 + docx 结构稿导出
 * @param {{
 *   reportMonth: string
 *   scoredRows: import('../../lib/postUseRating/parseChannels.js').NormalizedPostUseRow[]
 *   productNames: string[]
 *   visits?: object[]
 *   actionItems?: object[]
 *   reasons?: { reason: string; count: number; channel?: string }[]
 * }} props
 */
export default function PostUseMonthlyReportPreview(props) {
  const [exporting, setExporting] = useState(false)
  const model = useMemo(
    () =>
      buildMonthlyReportPreviewModel({
        reportMonth: props.reportMonth,
        scoredRows: props.scoredRows,
        productNames: props.productNames,
        visits: props.visits,
        actionItems: props.actionItems,
        reasons: props.reasons,
      }),
    [props],
  )

  const onExportDocx = async () => {
    setExporting(true)
    try {
      const blob = await buildMonthlyReportDocxBlob(model)
      triggerDocxDownload(blob, `用后即评月报-${props.reportMonth}.docx`)
      message.success('已开始下载 docx 结构稿')
    } catch (e) {
      message.error(e?.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  if (!props.reportMonth || !props.scoredRows?.length) {
    return (
      <Alert
        type="info"
        showIcon
        title="导入当月渠道明细后可预览对外口径月报结构，并导出 docx 结构稿（图表像素对齐后置）"
      />
    )
  }

  return (
    <Card
      size="small"
      title={model.title}
      extra={
        <Button
          type="primary"
          size="small"
          icon={<DownloadOutlined />}
          loading={exporting}
          onClick={() => void onExportDocx()}
        >
          导出 docx 结构稿
        </Button>
      }
    >
      <Alert
        className="mb-3"
        type="warning"
        showIcon
        title="对外口径预览 · docx 为结构稿"
        description={
          <>
            {model.overview.note}
            <br />
            当前导出为结构稿：正文与表格可用，图表像素对齐仍后置。
          </>
        }
      />
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

      <Typography.Title level={5}>客服回访（{model.visitMonth}）</Typography.Title>
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

      <Typography.Text type="secondary" className="text-xs">
        举措：本月提出 {model.actionsProposed?.length || 0} · 本月关闭{' '}
        {model.actionsClosed?.length || 0}（完整闭环见举措与进展）
      </Typography.Text>
    </Card>
  )
}
