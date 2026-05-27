import { Tag } from 'antd'

export default function ThemeTags({ themes, max = 3 }) {
  const list = themes?.length ? themes : ['未分类']
  const shown = list.slice(0, max)
  const rest = list.length - shown.length

  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <Tag key={t} className="!mr-0">
          {t}
        </Tag>
      ))}
      {rest > 0 && <Tag className="!mr-0">+{rest}</Tag>}
    </div>
  )
}
