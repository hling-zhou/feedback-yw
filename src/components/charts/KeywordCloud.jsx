import { Empty, Tag } from 'antd'

export default function KeywordCloud({ keywords }) {
  if (!keywords?.length) {
    return <Empty className="py-8" description="暂无关键词" />
  }

  const max = keywords[0]?.count || 1

  return (
    <div className="flex flex-wrap gap-2 justify-center py-4">
      {keywords.map(({ word, count }) => {
        const scale = 0.75 + (count / max) * 0.75
        return (
          <Tag
            key={word}
            className="transition hover:bg-brand-50 hover:text-brand-700"
            style={{ fontSize: `${scale}rem` }}
            title={`${count} 次`}
          >
            {word}
          </Tag>
        )
      })}
    </div>
  )
}
