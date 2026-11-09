import { useEffect, useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Select, Space, Switch, Typography } from 'antd'
import { apiFetch } from '../lib/apiClient.js'
import { useAppMessage } from '../hooks/useAppMessage.js'
import FieldLabel from './FieldLabel.jsx'

/**
 * AI 巡检日报面板（Settings 邮件 tab 内，2026-11-07 拍板，docs/DESIGN-API巡检.md §8）。
 * 收件人群组与发信通道复用邮件 tab 既有配置（api_patrol 通道在此维护发件地址）；
 * 本面板只做：开关/群组选择/发送时刻/口径开关/明细上限/立即发送/上次状态。
 *
 * @param {Object} props
 * @param {boolean} props.canEdit - manageTags 权限
 */
export default function PatrolDailyReportPanel({ canEdit }) {
  const message = useAppMessage()
  /** @type {[any, import('react').Dispatch<any>]} */
  // @ts-ignore — useState 联合类型推断过宽；本地默认值与 DEFAULT_PATROL_REPORT_CONFIG 口径一致（load 后覆盖）
  const [draft, setDraft] = useState(() => ({
    enabled: false, groupIds: [], channelId: '', sendTime: '10:30', includeQuiet: true, excludeSimTagged: false, maxInterfacesPerProduct: 20,
  }))
  /** @type {[any, import('react').Dispatch<any>]} */
  // @ts-ignore — 同上
  const [groups, setGroups] = useState([])
  /** @type {[any, import('react').Dispatch<any>]} */
  // @ts-ignore — 同上
  const [channels, setChannels] = useState([])
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)

  const load = async () => {
    try {
      const [mail, config, st] = await Promise.all([
        apiFetch('/api/mail/status'),
        apiFetch('/api/patrol/report/config'),
        apiFetch('/api/patrol/report/status'),
      ])
      setGroups(Array.isArray(mail.groups) ? mail.groups : [])
      setChannels(Array.isArray(mail.channels) ? mail.channels : [])
      setDraft({ ...config })
      setStatus(st)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '读取日报配置失败')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch('/api/patrol/report/config', {
        method: 'PUT',
        body: JSON.stringify(draft),
      })
      message.success('已保存日报配置')
      setDraft({ ...res.config })
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSendNow = () => {
    Modal.confirm({
      title: '立即发送 AI 巡检日报？',
      content: '将按当前配置立即发送昨日数据的日报（不受"当日已发"限制，可用于测试与补发）。',
      okText: '发送',
      cancelText: '取消',
      onOk: async () => {
        setSending(true)
        try {
          const res = await apiFetch('/api/patrol/report/send', {
            method: 'POST',
            body: JSON.stringify({}),
          })
          if (res.skipped) {
            message.info(`未发送：${res.skipped === 'disabled' ? '日报未启用' : res.skipped === 'quiet' ? '昨日无数据且未启用平静简报' : '其他原因'}（${res.skipped}）`)
          } else {
            message.success(`日报已发送：收件人 ${res.recipients ?? 0} 人 · 产品 ${res.products ?? 0} 个（报告日 ${res.date}）`)
          }
          await load()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '发送失败')
        } finally {
          setSending(false)
        }
      },
    })
  }

  const state = status?.state || {}
  const lastResultText = {
    sent: `已发送（${state.lastSentAt || ''}）`,
    quiet_skipped: '平静跳过（昨日无数据且未启用简报）',
    error: `发送失败：${state.lastError || '未知原因'}`,
  }[String(state.lastResult || '')]

  return (
    <div className="space-y-3">
      <Typography.Text type="secondary" className="block text-xs">
        每日按配置时刻自动发送<strong>昨日全天</strong>的 AI 巡检日报（按产品：异常接口统计 + 待产品侧处理请求与根因分布）；
        报告窗口=T-1、成功率取推送值、明细上限每产品 {draft.maxInterfacesPerProduct} 行、&lt;99.5% 排序在前；
        仿真/测试流量默认计入并在列表中打标记、排至末尾。发信通道（SMTP/发件地址）在上方「发信通道」卡片维护，
        在此选择日报使用哪个通道。
      </Typography.Text>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel required>启用每日自动发送</FieldLabel>
          <Switch
            checked={draft.enabled === true}
            onChange={(v) => setDraft((prev) => ({ ...prev, enabled: v }))}
            disabled={!canEdit}
          />
        </div>
        <div>
          <FieldLabel required hint="24 小时制 HH:mm，默认 10:30">每日发送时刻</FieldLabel>
          <Input
            placeholder="10:30"
            value={draft.sendTime}
            onChange={(e) => setDraft((prev) => ({ ...prev, sendTime: e.target.value }))}
            disabled={!canEdit}
            className="!w-32"
          />
        </div>
      </div>

      <div>
        <FieldLabel required hint="多选，发送时合并去重">收件人群组</FieldLabel>
        <Select
          mode="multiple"
          placeholder="选择邮件群组（在上方「收件人群组」维护成员）"
          value={draft.groupIds}
          onChange={(v) => setDraft((prev) => ({ ...prev, groupIds: v }))}
          disabled={!canEdit}
          options={groups.map((g) => ({ label: `${g.name}（${(g.emails || []).length} 人）`, value: g.id }))}
          style={{ width: '100%' }}
        />
      </div>

      <div>
        <FieldLabel required hint="SMTP/发件地址在上方「发信通道」卡片维护">日报发信通道</FieldLabel>
        <Select
          placeholder="选择日报使用的发信通道"
          value={draft.channelId || undefined}
          onChange={(v) => setDraft((prev) => ({ ...prev, channelId: v || '' }))}
          disabled={!canEdit}
          options={channels.map((c) => ({ label: `${c.name || '通道'}（${c.fromAddress}）`, value: c.id }))}
          style={{ width: '100%' }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <FieldLabel hint="默认开">无异常也发平静简报</FieldLabel>
          <Switch
            checked={draft.includeQuiet !== false}
            onChange={(v) => setDraft((prev) => ({ ...prev, includeQuiet: v }))}
            disabled={!canEdit}
          />
        </div>
        <div>
          <FieldLabel hint="默认不排除（计入并打标）">排除仿真/测试流量</FieldLabel>
          <Switch
            checked={draft.excludeSimTagged === true}
            onChange={(v) => setDraft((prev) => ({ ...prev, excludeSimTagged: v }))}
            disabled={!canEdit}
          />
        </div>
        <div>
          <FieldLabel hint="防刷屏，5-100">每产品明细上限</FieldLabel>
          <InputNumber
            min={5}
            max={100}
            value={draft.maxInterfacesPerProduct}
            onChange={(v) => setDraft((prev) => ({ ...prev, maxInterfacesPerProduct: Number(v) || 20 }))}
            disabled={!canEdit}
          />
        </div>
      </div>

      <Space>
        <Button type="primary" loading={saving} onClick={handleSave} disabled={!canEdit}>
          保存日报配置
        </Button>
        <Button loading={sending} onClick={handleSendNow} disabled={!canEdit}>
          立即发送（测试/补发）
        </Button>
      </Space>

      {state.lastResult ? (
        <Alert
          type={state.lastResult === 'sent' ? 'success' : state.lastResult === 'error' ? 'error' : 'info'}
          showIcon
          title={`上次发送：${lastResultText}`}
        />
      ) : (
        <Alert type="info" showIcon title="尚未发送过日报" />
      )}
    </div>
  )
}
