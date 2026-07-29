import { useEffect, useMemo, useState } from 'react'
import { Drawer, Empty, Input, Segmented, Space, Tag, Timeline, Typography } from 'antd'
import { WHATS_NEW_DRAWER_WIDTH } from '../constants/appLayout.js'
import {
  WHATS_NEW_CATEGORY_LABELS,
  WHATS_NEW_MODULE_LABELS,
  groupWhatsNewItemsByMonth,
  markWhatsNewFeedSeen,
} from '../domain/whatsNewFeed.js'
import { fetchWhatsNewFeed } from '../lib/whatsNewFeedClient.js'

/** @typedef {import('../domain/whatsNewFeed.js').WhatsNewCategory} WhatsNewCategory */
/** @typedef {import('../domain/whatsNewFeed.js').WhatsNewFeed} WhatsNewFeed */
/** @typedef {import('../domain/whatsNewFeed.js').WhatsNewItem} WhatsNewItem */

const CATEGORY_COLORS = {
  feature: 'blue',
  fix: 'orange',
  improvement: 'green',
}

/**
 * @param {{
 *   open: boolean
 *   onClose: () => void
 *   onMarkedSeen?: () => void
 * }} props
 */
export default function WhatsNewDrawer({ open, onClose, onMarkedSeen }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [feed, setFeed] = useState(/** @type {WhatsNewFeed | null} */ (null))
  const [category, setCategory] = useState(/** @type {'all' | WhatsNewCategory} */ ('all'))
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchWhatsNewFeed()
      .then((data) => {
        if (cancelled) return
        setFeed(data)
        markWhatsNewFeedSeen(new Date().toISOString())
        onMarkedSeen?.()
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载失败')
        setFeed({ generatedAt: '', source: 'git', items: [] })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, onMarkedSeen])

  const filtered = useMemo(() => {
    const items = feed?.items || []
    const q = keyword.trim().toLowerCase()
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      if (!q) return true
      const hay = `${item.title} ${item.summary || ''} ${(item.modules || []).join(' ')}`.toLowerCase()
      return hay.includes(q)
    })
  }, [feed, category, keyword])

  const months = useMemo(() => {
    const grouped = groupWhatsNewItemsByMonth(filtered)
    return Object.keys(grouped)
      .sort((a, b) => b.localeCompare(a))
      .map((month) => ({ month, items: grouped[month] }))
  }, [filtered])

  return (
    <Drawer
      title="更新动态"
      size={WHATS_NEW_DRAWER_WIDTH}
      open={open}
      onClose={onClose}
      closable={{ placement: 'end' }}
      destroyOnClose={false}
      styles={{ body: { paddingTop: 12 } }}
    >
      <Typography.Paragraph type="secondary" className="!mb-3 text-xs">
        随构建从 Git 同步的功能更新
        {feed?.generatedAt ? ` · 生成于 ${feed.generatedAt.slice(0, 10)}` : ''}
      </Typography.Paragraph>

      <Space orientation="vertical" size="middle" className="mb-4 w-full">
        <Segmented
          block
          value={category}
          onChange={(value) => setCategory(/** @type {'all' | WhatsNewCategory} */ (value))}
          options={[
            { label: '全部', value: 'all' },
            { label: '新功能', value: 'feature' },
            { label: '修复', value: 'fix' },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="搜索标题"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </Space>

      {loading ? (
        <Typography.Text type="secondary">加载中…</Typography.Text>
      ) : error ? (
        <Typography.Text type="danger">{error}</Typography.Text>
      ) : months.length === 0 ? (
        <Empty description="暂无变更记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space orientation="vertical" size="large" className="w-full">
          {months.map(({ month, items }) => (
            <div key={month}>
              <Typography.Title level={5} className="!mb-3">
                {month}
              </Typography.Title>
              <Timeline
                items={items.map((item) => ({
                  key: item.id,
                  children: <WhatsNewTimelineItem item={item} />,
                }))}
              />
            </div>
          ))}
        </Space>
      )}
    </Drawer>
  )
}

/**
 * @param {{ item: WhatsNewItem }} props
 */
function WhatsNewTimelineItem({ item }) {
  return (
    <div className="pb-1">
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <Tag color={CATEGORY_COLORS[item.category] || 'default'} className="!mr-0">
          {WHATS_NEW_CATEGORY_LABELS[item.category] || item.category}
        </Tag>
        {(item.modules || []).map((mod) => (
          <Tag key={mod} className="!mr-0">
            {WHATS_NEW_MODULE_LABELS[mod] || mod}
          </Tag>
        ))}
        <Typography.Text type="secondary" className="text-xs">
          {item.publishedAt}
        </Typography.Text>
      </div>
      <Typography.Text className="block text-sm leading-snug">{item.title}</Typography.Text>
      {item.summary ? (
        <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 text-xs">
          {item.summary}
        </Typography.Paragraph>
      ) : null}
      {item.commitUrl ? (
        <Typography.Link href={item.commitUrl} target="_blank" rel="noreferrer" className="text-xs">
          查看提交
        </Typography.Link>
      ) : null}
    </div>
  )
}
