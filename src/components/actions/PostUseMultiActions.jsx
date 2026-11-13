import { useEffect, useState } from 'react'
import { Button, DatePicker, Input, Popconfirm, Radio, Space, Typography, message } from 'antd'
import dayjs from 'dayjs'
import ActionItemSelect from '../ActionItemSelect.jsx'
import ActionItemStatusTag from '../tags/ActionItemStatusTag.jsx'
import FieldLabel from '../FieldLabel.jsx'
import { getActionItemDisplayScheduleAt, getActionItemDisplayStatus } from '../../domain/requirementTicketProgress.js'
import {
  ESTABLISHED_ACTION_DETAIL_MAX_LENGTH,
  ESTABLISHED_ACTION_MAX_LENGTH,
} from '../../domain/establishedAction.js'
import {
  addPostUseAction,
  listPostUseActions,
  removePostUseAction,
} from '../../lib/postUseActionClient.js'

/**
 * 产品部溯源与省代表回访共用的多条确立举措区块。
 * @param {{ ownerType: 'trace'|'visit'; ownerId: string; productKey: string; open: boolean; canEdit: boolean; onOwnerSaved?: (item: any) => void }} props
 */
export default function PostUseMultiActions({ ownerType, ownerId, productKey, open, canEdit, onOwnerSaved }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [mode, setMode] = useState('library')
  const [selected, setSelected] = useState(null)
  const [content, setContent] = useState('')
  const [detail, setDetail] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())

  useEffect(() => {
    if (!open || !ownerId) return
    let active = true
    setLoading(true)
    setEditorOpen(false)
    setExpandedIds(new Set())
    listPostUseActions(ownerType, ownerId)
      .then((result) => { if (active) setItems(result?.items || []) })
      .catch((error) => { if (active) message.error(error?.message || '加载举措失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, ownerType, ownerId])

  const refresh = async () => {
    const result = await listPostUseActions(ownerType, ownerId)
    setItems(result?.items || [])
  }

  const resetEditor = () => {
    setEditorOpen(false)
    setMode('library')
    setSelected(null)
    setContent('')
    setDetail('')
    setScheduleAt('')
  }

  const handleAdd = async () => {
    if (mode === 'library' && !selected?.id) return message.warning('请选择举措')
    if (mode === 'new' && !content.trim()) return message.warning('请填写举措内容')
    if (mode === 'library' && items.some((item) => item.id === selected.id)) {
      return message.warning('这条举措已关联当前记录')
    }
    setSaving(true)
    try {
      const result = await addPostUseAction(ownerType, ownerId, mode === 'library'
        ? { actionId: selected.id }
        : { newAction: { content: content.trim(), detail: detail.trim(), scheduleAt } })
      onOwnerSaved?.(result.item)
      setItems((previous) => previous.some((item) => item.id === result.action.id)
        ? previous : [...previous, result.action])
      resetEditor()
      message.success('举措已关联')
      try { await refresh() } catch { message.warning('举措已关联，列表刷新失败，请重新打开抽屉') }
    } catch (error) {
      message.error(error?.message || '关联举措失败')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (actionId) => {
    setSaving(true)
    try {
      const result = await removePostUseAction(ownerType, ownerId, actionId)
      onOwnerSaved?.(result.item)
      setItems((previous) => previous.filter((item) => item.id !== actionId))
      message.success('已移除关联，举措仍保留在举措库')
      try { await refresh() } catch { message.warning('关联已移除，列表刷新失败，请重新打开抽屉') }
    } catch (error) {
      message.error(error?.message || '移除关联失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleDetail = (id) => {
    setExpandedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section aria-label="确立举措">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Typography.Text type="secondary">确立举措（{items.length}）</Typography.Text>
        {canEdit && (
          <Button size="small" disabled={saving} onClick={() => setEditorOpen(true)}>
            添加举措
          </Button>
        )}
      </div>

      {loading ? (
        <Typography.Text type="secondary">正在加载举措…</Typography.Text>
      ) : items.length ? (
        <div className="space-y-2">
          {items.map((item) => {
            const status = item.missing ? null : getActionItemDisplayStatus(item)
            const displaySchedule = item.missing ? '' : getActionItemDisplayScheduleAt(item)
            return (
              <div key={item.id} className="rounded border border-line-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Typography.Text className="min-w-0 flex-1 break-words font-medium">
                    {item.missing ? `举措不存在（${item.id}）` : item.content}
                  </Typography.Text>
                  {status && <ActionItemStatusTag status={status} />}
                </div>
                {!item.missing && (
                  <Typography.Text type="secondary" className="mt-1 block text-xs">
                    排期：{displaySchedule || '待评估'}
                  </Typography.Text>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                  {!item.missing && (
                    <Button type="link" size="small" className="!px-0" onClick={() => toggleDetail(item.id)}>
                      {expandedIds.has(item.id) ? '收起详情' : '查看详情'}
                    </Button>
                  )}
                  {canEdit && (
                    <Popconfirm
                      title="移除与当前记录的关联？"
                      description="举措仍保留在举措库。"
                      okText="移除关联"
                      cancelText="取消"
                      onConfirm={() => void handleRemove(item.id)}
                    >
                      <Button type="link" size="small" danger disabled={saving} className="!px-0">
                        移除关联
                      </Button>
                    </Popconfirm>
                  )}
                </div>
                {expandedIds.has(item.id) && !item.missing && (
                  <div className="mt-2 border-t border-line-200 pt-2 whitespace-pre-wrap text-sm text-ink-700">
                    {item.detail || '暂无举措详情'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <Typography.Text type="secondary">暂无确立举措</Typography.Text>
      )}

      {canEdit && editorOpen && (
        <div className="mt-3 rounded border border-line-200 p-3">
          <Typography.Text className="mb-3 block font-medium">添加举措</Typography.Text>
          <Radio.Group
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            options={[{ label: '从举措库选择', value: 'library' }, { label: '新建举措', value: 'new' }]}
          />
          <div className="mt-3">
            {mode === 'library' ? (
              <ActionItemSelect
                value={selected?.id || ''}
                productKey={productKey}
                source="post_use"
                onSelect={setSelected}
                onClear={() => setSelected(null)}
              />
            ) : (
              <div className="space-y-3">
                <div>
                  <FieldLabel required>举措内容</FieldLabel>
                  <Input.TextArea
                    rows={3}
                    value={content}
                    maxLength={ESTABLISHED_ACTION_MAX_LENGTH}
                    showCount
                    placeholder="填写举措内容"
                    onChange={(event) => setContent(event.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel>举措详情（可选）</FieldLabel>
                  <Input.TextArea
                    rows={3}
                    value={detail}
                    maxLength={ESTABLISHED_ACTION_DETAIL_MAX_LENGTH}
                    showCount
                    placeholder="补充执行步骤"
                    onChange={(event) => setDetail(event.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel>排期</FieldLabel>
                  <DatePicker
                    className="w-full"
                    format="YYYY-MM-DD"
                    placeholder="留空 = 待评估"
                    value={scheduleAt ? dayjs(scheduleAt, 'YYYY-MM-DD') : null}
                    onChange={(date) => setScheduleAt(date ? date.format('YYYY-MM-DD') : '')}
                  />
                </div>
              </div>
            )}
          </div>
          <Space className="mt-3 flex justify-end">
            <Button onClick={resetEditor} disabled={saving}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void handleAdd()}>
              {mode === 'library' ? '关联举措' : '保存并关联'}
            </Button>
          </Space>
        </div>
      )}
    </section>
  )
}
