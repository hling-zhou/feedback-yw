import { Drawer, Typography, Tag, Table, Empty, Divider, Button, Space } from 'antd'
import { WarningOutlined } from '@ant-design/icons'

/** @typedef {import('../../lib/types.js').FeedbackRecord} FeedbackRecord */

const FIX_HINT_LABELS = {
  add_coverage: '需补充分类法正则或子议题，扩大覆盖面',
  restrict_overbroad: '需收紧过宽正则边界，减少误吸收',
  demote_tier: '样本不足的项需降级到零散长尾层',
  recross: '共性项需单独归类，不混入五层',
  annotate: '需补充〔痛点摘要〕/〔复核根因〕标注',
  adjust_boundary: '需调整家族排除规则(exclude)，防止误归属',
  restrict_term: '需收紧泛词/种子词，减少跨家族误吸',
}

/**
 * 门禁详情抽屉 — 展示每项失败检查的具体原因、涉及工单，支持点击工单叠加工单详情抽屉。
 *
 * @param {Object} props
 * @param {object|null} props.gateReport - 快照中的 gateReport
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {FeedbackRecord[]} [props.records=[]] - 全量工单，用于按工单号查找
 * @param {(record: FeedbackRecord) => void} [props.onOpenFeedback] - 点击工单号时触发
 */
export default function GateDetailDrawer({ gateReport, open, onClose, records = [], onOpenFeedback }) {
  if (!gateReport) return null

  const failures = gateReport.failures || []

  return (
    <Drawer
      title={
        <Space>
          <WarningOutlined style={{ color: '#faad14' }} />
          <span>门禁失败项明细</span>
          <Tag color="orange">{gateReport.rounds} 轮</Tag>
          <Tag color="red">{gateReport.failureCount} 项失败</Tag>
        </Space>
      }
      placement="right"
      width={720}
      open={open}
      onClose={onClose}
      zIndex={1000}
    >
      {/* 概要 */}
      <div className="page-card-sm" style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary" className="text-sm">
          三方闭环 {gateReport.rounds} 轮未通过门禁，已升级人工复核。
          以下为每项失败检查的详细原因和涉及的工单，可点击工单号查看详情并手动修改打标。
        </Typography.Text>
      </div>

      {/* 逐项失败明细 */}
      <div className="drawer-space-y">
        {failures.map((f, idx) => (
          <div key={idx} className="drawer-section-gap">
            {/* 检查项标题 */}
            <div className="flex items-center gap-2 flex-wrap">
              <Tag color="red" className="!m-0 !text-xs">{f.level || 'FAIL'}</Tag>
              <Typography.Text strong className="text-sm">{f.name}</Typography.Text>
            </div>

            {/* 详情卡片 */}
            <div className="page-card-sm">
              {/* 失败原因 */}
              <div className="mb-2">
                <Typography.Text type="secondary" className="text-xs">失败原因：</Typography.Text>
                <Typography.Paragraph className="text-sm !mb-0 mt-1">{f.detail}</Typography.Paragraph>
              </div>

              {/* 人工复核指引 */}
              {f.fixHint && (
                <div className="flex items-start gap-1.5 mt-2">
                  <Typography.Text type="secondary" className="text-xs shrink-0 mt-0.5">人工复核指引：</Typography.Text>
                  <Typography.Text className="text-xs text-gray-600">
                    {FIX_HINT_LABELS[f.fixHint] || f.fixHint}
                  </Typography.Text>
                </div>
              )}

              {/* 涉及工单 */}
              {f.evidence && f.evidence.length > 0 ? (
                <div className="mt-3">
                  <Divider className="!my-2" />
                  <Typography.Text type="secondary" className="text-xs mb-2 block">
                    涉及工单（{f.evidence.length} 条{f.evidence.length >= 20 ? '，仅显示前 20 条' : ''}）
                  </Typography.Text>
                  <Table
                    size="small"
                    rowKey={(r) => r.id || r.text}
                    dataSource={f.evidence}
                    pagination={false}
                    scroll={{ x: 400 }}
                    columns={[
                      {
                        title: '工单号',
                        dataIndex: 'id',
                        width: 160,
                        ellipsis: false,
                        render: (value, row) => {
                          const record = records.find(r => r.id === value || r.ticketId === value)
                          const ticketId = record?.ticketId || value || row.id
                          if (record && onOpenFeedback) {
                            return (
                              <Button type="link" size="small" className="!px-0" onClick={() => onOpenFeedback(record)}>
                                <span style={{ wordBreak: 'break-all' }}>{ticketId}</span>
                              </Button>
                            )
                          }
                          return <span style={{ wordBreak: 'break-all' }}>{ticketId || '-'}</span>
                        },
                      },
                      {
                        title: '来源',
                        width: 70,
                        render: (_, row) => {
                          const record = records.find(r => r.id === row.id || r.ticketId === row.id)
                          const dst = record?.dataSourceType
                          const map = {
                            complaint_ticket: { label: '投诉', color: 'red' },
                            consultation_ticket: { label: '咨询', color: 'blue' },
                            post_use_rating: { label: '用后即评', color: 'green' },
                            user_survey: { label: '调研', color: 'purple' },
                            other: { label: '其他', color: 'default' },
                          }
                          if (!dst) return <span>-</span>
                          const cfg = map[dst] || { label: dst, color: 'default' }
                          return <Tag color={cfg.color} className="!text-xs">{cfg.label}</Tag>
                        },
                      },
                      {
                        title: '内容',
                        dataIndex: 'text',
                        ellipsis: true,
                      },
                    ]}
                  />
                </div>
              ) : (
                <div className="mt-2">
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无关联工单数据" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  )
}
