/** @param {{ meta?: { username?: string, displayName?: string, editedAt?: string } | null }} props */
export default function FieldEditorMeta({ meta }) {
  if (!meta?.username) {
    return <div className="text-xs text-ink-500">暂无线上编辑记录</div>
  }
  const date = new Date(meta.editedAt || '')
  const editedAt = Number.isNaN(date.getTime())
    ? meta.editedAt || ''
    : date.toLocaleString('zh-CN', { hour12: false })
  return (
    <div className="text-xs text-ink-500">
      编辑人：{meta.displayName || meta.username} · 编辑时间：{editedAt || '—'}
    </div>
  )
}
