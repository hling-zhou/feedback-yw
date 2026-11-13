import { useEffect, useMemo, useState } from 'react'
import { Button, Popover, Space, Typography, message } from 'antd'
import { listPostUseActionSources } from '../../lib/postUseActionClient.js'

/**
 * 用后即评举措列表的「关联反馈」单元格：展示溯源与回访的全部关联。
 *
 * @param {Object} props
 * @param {string} props.actionId
 */
export default function PostUseLinkedFeedbackCell({ actionId }) {
  const [items, setItems] = useState({ traces: [], visits: [] })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!actionId) return
    let cancelled = false
    setLoading(true)
    listPostUseActionSources(actionId)
      .then((res) => {
        if (cancelled) return
        setItems({ traces: res?.traces || [], visits: res?.visits || [] })
      })
      .catch(() => {
        if (cancelled) return
        setItems({ traces: [], visits: [] })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [actionId])

  const count = items.traces.length + items.visits.length

  const content = useMemo(() => {
    if (!count) {
      return (
        <Typography.Text type="secondary" className="text-xs">
          暂无关联溯源或回访
        </Typography.Text>
      )
    }
    return (
      <div className="min-w-[16rem] max-w-[24rem] max-h-56 overflow-y-auto">
        <Typography.Text type="secondary" className="mb-2 block text-xs">
          共 {items.traces.length} 条溯源、{items.visits.length} 条回访
        </Typography.Text>
        <Space direction="vertical" size={8} className="w-full">
          {[
            ...items.traces.map((item) => ({ ...item, linkType: '产品部溯源' })),
            ...items.visits.map((item) => ({ ...item, linkType: '省代表回访' })),
          ].map((item) => (
            <div key={`${item.linkType}:${item.id}`} className="rounded border border-line-200 p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <Typography.Text className="text-xs font-medium text-ink-800">
                  {item.linkType} · {item.customerName || item.groupName || '—'}
                </Typography.Text>
                <Typography.Text type="secondary" className="text-[10px]">
                  {item.importMonth || ''}
                </Typography.Text>
              </div>
              <Typography.Text type="secondary" className="block text-[11px]">
                产品：{item.product || item.productName || '—'}
              </Typography.Text>
              <Typography.Text className="block text-[11px] text-ink-700">
                {item.linkType === '产品部溯源'
                  ? `建议回访原因：${item.recommendedReason || '—'}`
                  : `回访结果：${item.visitResult || '—'}`}
              </Typography.Text>
            </div>
          ))}
        </Space>
      </div>
    )
  }, [items, count])

  if (!actionId) return <Typography.Text type="secondary">—</Typography.Text>

  return (
    <Popover content={content} title="关联溯源项" trigger="hover">
      <Button type="link" size="small" loading={loading} className="!px-0">
        {count} 条关联
      </Button>
    </Popover>
  )
}
