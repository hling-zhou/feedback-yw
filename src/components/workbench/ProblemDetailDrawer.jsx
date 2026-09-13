import { Drawer, Table, Tag, Typography, Divider, Empty, Button } from 'antd'

/** @typedef {import('../../domain/overviewConclusions.js').ActionRecsResult} ActionRecsResult */
/** @typedef {import('../../lib/types.js').FeedbackRecord} FeedbackRecord */

const STATUS_LABELS = {
  pending_evaluation: { label: '待评估', color: 'gold' },
  in_progress: { label: '进行中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
  suspended: { label: '暂停', color: 'warning' },
  not_implemented: { label: '不实施', color: 'default' },
  abnormal_terminated: { label: '异常终止', color: 'error' },
}

/**
 * 详情抽屉，展示定性描述 + 原声 + 关联举措 + 涉及工单。
 *
 * @param {Object} props
 * @param {ActionRecsResult | null} props.rec
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {FeedbackRecord[]} [props.records] - 用于工单详情展示
 * @param {boolean} [props.showEffectTable=false] - 投诉/咨询 tab 专用：是否展示效果验证表
 * @param {(record: FeedbackRecord) => void} [props.onOpenFeedback] - 点击工单号时触发，叠加工单详情抽屉
 */
export default function ProblemDetailDrawer({ rec, open, onClose, records = [], showEffectTable = false, onOpenFeedback }) {
  if (!rec) return null

  const problemSummary = rec.problemSummary || {}
  const customerVoice = rec.customerVoice || {}
  const scale = rec.scale || {}

  // 涉及工单
  const ticketIds = rec.evidenceTicketIds || []
  const ticketRecords = ticketIds
    .map((id) => records.find((r) => r.id === id || r.ticketId === id))
    .filter(Boolean)

  // 关联举措
  const inventoryActions = rec.inventoryActions || []

  return (
    <Drawer
      title={rec.summary || '详情'}
      placement="right"
      width={640}
      open={open}
      onClose={onClose}
      zIndex={1000}
    >
      {/* 定性描述区 */}
      <div className="mb-4">
        <Typography.Title level={5}>定性描述</Typography.Title>
        {problemSummary.pain && (
          <div className="mb-2">
            <Tag color="orange" className="!mb-1">痛点摘要</Tag>
            <Typography.Paragraph className="text-sm" type="secondary">
              {problemSummary.pain}
            </Typography.Paragraph>
          </div>
        )}
        {problemSummary.root && (
          <div className="mb-2">
            <Tag color="blue" className="!mb-1">复核根因</Tag>
            <Typography.Paragraph className="text-sm" type="secondary">
              {problemSummary.root}
            </Typography.Paragraph>
          </div>
        )}
        {customerVoice.verbatim && (
          <div className="mb-2">
            <Tag color="purple" className="!mb-1">客户原声</Tag>
            <Typography.Paragraph className="text-sm" italic>
              "{customerVoice.verbatim}"
            </Typography.Paragraph>
          </div>
        )}
      </div>

      <Divider />

      {/* 规模情况 */}
      <div className="mb-4">
        <Typography.Title level={5}>规模情况</Typography.Title>
        <div className="flex flex-wrap gap-4 text-sm">
          <span>工单数：{scale.ticketCount || 0}</span>
          <span>投诉：{scale.complaintCount || 0}</span>
          <span>咨询：{scale.consultationCount || 0}</span>
          <span>投诉率：{Number(scale.complaintRate || 0).toFixed(0)}%</span>
          <span>加急率：{Number(scale.urgentRate || 0).toFixed(0)}%</span>
          {scale.moMPct !== undefined && (
            <span>环比：{scale.moMPct > 0 ? '+' : ''}{scale.moMPct}%</span>
          )}
        </div>
      </div>

      <Divider />

      {/* 关联举措区 */}
      <div className="mb-4">
        <Typography.Title level={5}>关联举措</Typography.Title>
        {inventoryActions.length ? (
          <div className="space-y-2">
            {inventoryActions.map((action) => {
              const statusCfg = STATUS_LABELS[action.status] || { label: action.status, color: 'default' }
              return (
                <div key={action.id} className="flex items-start gap-2">
                  <Tag color={statusCfg.color} className="!mt-0.5">{statusCfg.label}</Tag>
                  <div className="flex-1">
                    <Typography.Text className="text-sm">{action.title}</Typography.Text>
                    {action.productName && (
                      <Typography.Text type="secondary" className="text-xs ml-2">{action.productName}</Typography.Text>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无关联举措" />
        )}

        {/* 候选动作（Layer A） */}
        {rec.actionsLayerA?.length > 0 && (
          <div className="mt-3">
            <Typography.Text type="secondary" className="text-xs">候选优化动作：</Typography.Text>
            <div className="mt-1 space-y-1">
              {rec.actionsLayerA.map((action, i) => (
                <div key={i} className="text-sm">
                  <Tag className="!mr-1">#{i + 1}</Tag>
                  {action.text}
                  <Typography.Text type="secondary" className="text-xs ml-2">（{action.freq}次）</Typography.Text>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Divider />

      {/* 涉及工单表 */}
      <div>
        <Typography.Title level={5}>涉及工单</Typography.Title>
        {ticketRecords.length ? (
          <Table
            size="small"
            rowKey={(r) => r.id || r.ticketId}
            dataSource={ticketRecords}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            scroll={{ x: 400 }}
            columns={[
              {
                title: '工单号',
                dataIndex: 'ticketId',
                width: 120,
                ellipsis: true,
                render: (value, row) => (
                  <Button
                    type="link"
                    size="small"
                    className="!px-0"
                    onClick={() => onOpenFeedback?.(row)}
                  >
                    {value || row.id}
                  </Button>
                ),
              },
              { title: '产品', dataIndex: 'productName', width: 100, ellipsis: true },
              { title: '问题类型', dataIndex: 'problemType', width: 100, ellipsis: true },
              { title: '需求痛点', dataIndex: 'painPoint', ellipsis: true },
            ]}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无关联工单" />
        )}
      </div>
    </Drawer>
  )
}
