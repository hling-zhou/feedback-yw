import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Space, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { useInsights } from '../../context/InsightsContext.jsx'

export function normalizeKeyCustomerDraftText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * @param {{
 *   readOnly?: boolean
 * }} props
 */
export default function PostUseKeyCustomersPanel({ readOnly = false }) {
  const message = useAppMessage()
  const { settings, setTeamSettings } = useInsights()
  const [draftText, setDraftText] = useState(() => (settings.postUseKeyCustomers || []).join('\n'))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraftText((settings.postUseKeyCustomers || []).join('\n'))
  }, [settings.postUseKeyCustomers])

  const normalizedDraft = useMemo(() => normalizeKeyCustomerDraftText(draftText), [draftText])
  const savedText = useMemo(
    () => (settings.postUseKeyCustomers || []).join('\n'),
    [settings.postUseKeyCustomers],
  )
  const dirty = draftText !== savedText

  const handleSave = () => {
    if (readOnly) return
    setSaving(true)
    try {
      setTeamSettings({ postUseKeyCustomers: normalizedDraft })
      message.success('已保存重点客户名单，保存后生效')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setDraftText(savedText)
  }

  return (
    <>
      <div className={`space-y-4 ${dirty ? 'pb-20' : ''}`}>
        <Card title="用后即评重点客户名单">
          <Typography.Text type="secondary" className="mb-3 block text-xs">
            用于“建议客服部回访客户清单”筛选。一行一个客户关键词，系统按客户名称包含匹配：
            名单关键词包含客户名，或客户名包含名单关键词，均视为命中。修改后需要点击保存才会生效。
          </Typography.Text>
          <Input.TextArea
            rows={12}
            placeholder={'中国铁塔\n九识智能\n曙光天玑'}
            value={draftText}
            disabled={readOnly}
            onChange={(e) => setDraftText(e.target.value)}
          />
          <Typography.Text type="secondary" className="mt-2 block text-xs">
            当前共 {normalizedDraft.length} 条关键词，可用于用后即评综合分析中的客服部回访建议清单。
          </Typography.Text>
          <Typography.Text type="secondary" className="mt-1 block text-xs">
            保存后可前往 <Link to="/workbench?tab=post_use_rating">洞察工作台 → 用后即评</Link> 查看结果。
          </Typography.Text>
        </Card>
      </div>

      {dirty ? (
        <div className="page-sticky-footer">
          <div className="flex max-w-2xl flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4 lg:px-5">
            <Typography.Text type="secondary" className="text-sm">
              有未保存的重点客户名单修改
            </Typography.Text>
            <Space wrap>
              <Button disabled={saving} onClick={handleDiscard}>
                放弃更改
              </Button>
              <Button type="primary" loading={saving} disabled={readOnly} onClick={handleSave}>
                保存后生效
              </Button>
            </Space>
          </div>
        </div>
      ) : null}
    </>
  )
}
