import { useEffect, useMemo, useState } from 'react'
import { Button, Popover, Space, Typography, message } from 'antd'
import { listPostUseJiraItems } from '../../lib/postUseJiraClient.js'

/**
 * 用后即评举措列表的「关联反馈」单元格：source='post_use' 时，
 * 关联的是 post_use_jira_items（溯源项），展示客户+产品+建议回访原因。
 *
 * @param {Object} props
 * @param {string} props.actionId
 */
export default function PostUseLinkedFeedbackCell({ actionId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!actionId) return
    let cancelled = false
    setLoading(true)
    listPostUseJiraItems({ actionId, limit: 100 })
      .then((res) => {
        if (cancelled) return
        setItems(res?.items || [])
      })
      .catch(() => {
        if (cancelled) return
        setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [actionId])

  const count = items.length

  const content = useMemo(() => {
    if (!count) {
      return (
        <Typography.Text type="secondary" className="text-xs">
          暂无关联溯源项
        </Typography.Text>
      )
    }
    return (
      <div className="min-w-[16rem] max-w-[24rem] max-h-56 overflow-y-auto">
        <Typography.Text type="secondary" className="mb-2 block text-xs">
          共 {count} 条溯源项
        </Typography.Text>
        <Space direction="vertical" size={8} className="w-full">
          {items.map((item) => (
            <div key={item.id} className="rounded border border-line-200 p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <Typography.Text className="text-xs font-medium text-ink-800">
                  {item.customerName || '—'}
                </Typography.Text>
                <Typography.Text type="secondary" className="text-[10px]">
                  {item.importMonth || ''}
                </Typography.Text>
              </div>
              <Typography.Text type="secondary" className="block text-[11px]">
                产品：{item.productName || '—'}
              </Typography.Text>
              <Typography.Text className="block text-[11px] text-ink-700">
                建议回访原因：{item.recommendedReason || '—'}
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
        {count} 个溯源
      </Button>
    </Popover>
  )
}
