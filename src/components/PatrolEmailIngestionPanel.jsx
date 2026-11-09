import { useEffect, useState } from 'react'
import { Alert, Button, Input, Space, Switch, Typography } from 'antd'
import { apiFetch } from '../lib/apiClient.js'
import { useAppMessage } from '../hooks/useAppMessage.js'
import FieldLabel from './FieldLabel.jsx'

/**
 * API 巡检邮件拉取面板（Settings 邮件 tab 内，docs/DESIGN-API巡检.md §9）。
 * Plan B 备用数据入口：每日 09:15 从 IMAP 邮箱拉取巡检邮件导入（P2-8 可观测性消费方）。
 * IMAP 授权码通过前端配置入库（对齐 SMTP 发信通道 password 口径），非环境变量。
 *
 * @param {Object} props
 * @param {boolean} props.canEdit - manageTags 权限
 */
export default function PatrolEmailIngestionPanel({ canEdit }) {
  const message = useAppMessage()
  const [config, setConfig] = useState(null)
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(false)
  /** 授权码输入（不记 config 里——GET 不返明文，PUT 时同发送） */
  const [authCode, setAuthCode] = useState('')

  const load = async () => {
    try {
      const [cfg, st] = await Promise.all([
        apiFetch('/api/patrol/email-ingestion/config'),
        apiFetch('/api/patrol/email-ingestion/status'),
      ])
      setConfig(cfg)
      setStatus(st)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '读取邮件拉取配置失败')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleToggle = async (enabled) => {
    setSaving(true)
    try {
      const res = await apiFetch('/api/patrol/email-ingestion/config', {
        method: 'PUT',
        body: JSON.stringify({ ...config, enabled, imapAuthCode: authCode || '' }),
      })
      setConfig(res.config)
      setAuthCode('')
      message.success(enabled ? '已启用每日 09:15 自动拉取' : '已停用自动拉取')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleFetchNow = async () => {
    setFetching(true)
    try {
      const res = await apiFetch('/api/patrol/email-ingestion/fetch', {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      })
      const r = res.lastResult
      if (r === 'success') {
        message.success(`拉取成功：产品 ${res.lastStats?.products ?? 0} 个 · 统计 ${res.lastStats?.statsRows ?? 0} 行 · 明细 ${res.lastStats?.requestRows ?? 0} 行（数据日 ${res.lastStats?.dataDate}）`)
      } else if (r === 'no_email') {
        message.info('今日邮箱中未发现巡检邮件')
      } else if (r === 'sender_rejected') {
        message.warning(`邮件发件人不在白名单：${res.lastError || ''}`)
      } else {
        message.error(`拉取失败：${res.lastError || r}`)
      }
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '拉取失败')
    } finally {
      setFetching(false)
    }
  }

  const state = status?.state || {}
  const lastResultText = {
    success: `成功（${state.lastStats?.products ?? 0} 产品 · 统计 ${state.lastStats?.statsRows ?? 0} 行 · 明细 ${state.lastStats?.requestRows ?? 0} 行）`,
    no_email: '当日无巡检邮件（正常，不视为错误）',
    sender_rejected: `发件人被拒：${state.lastError || ''}`,
    parse_error: `解析失败：${state.lastError || ''}`,
    fetch_error: `连接失败：${state.lastError || ''}`,
    skipped: '今日已拉取（跳过）',
  }[String(state.lastResult || '')]

  const alertType = {
    success: 'success',
    no_email: 'info',
    skipped: 'info',
    sender_rejected: 'warning',
    parse_error: 'error',
    fetch_error: 'error',
  }[String(state.lastResult || '')]

  return (
    <div className="space-y-3">
      <Typography.Text type="secondary" className="block text-xs">
        Plan B 备用数据入口：每日 <strong>09:15</strong> 从巡检邮箱（IMAP）拉取当日报表邮件并导入——
        正文统计表入「异常接口统计」、附件 ZIP 明细入「请求明细」，与 HTTP 推送（Plan A）写入同一路径、互不冲突。
        发件人白名单：{(config?.senderWhitelist || []).join('、')}；仅接受白名单发件人的邮件。
      </Typography.Text>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel required hint="每日 09:15 自动拉取导入；在日报发送（10:30）之前">启用自动拉取</FieldLabel>
          <Switch
            checked={config?.enabled === true}
            onChange={handleToggle}
            loading={saving}
            disabled={!canEdit}
          />
        </div>
        <div>
          <FieldLabel hint="只读，企业邮箱固定值">IMAP 账号</FieldLabel>
          <Typography.Text className="text-sm">
            {config?.imapUser || '—'}@{config?.imapHost || ''}
          </Typography.Text>
        </div>
      </div>

      <div>
        <FieldLabel required hint="留空则保持原授权码（不覆盖）">
          授权码
          {config?.authCodeConfigured ? (
            <span className="ml-1.5 text-xs font-normal text-green-600">已配置</span>
          ) : (
            <span className="ml-1.5 text-xs font-normal text-red-500">未配置（⚠️ 无法连接邮箱）</span>
          )}
        </FieldLabel>
        <Input.Password
          placeholder="留空则保持原授权码不变"
          value={authCode}
          onChange={(e) => setAuthCode(e.target.value)}
          disabled={!canEdit}
          className="!w-80"
        />
      </div>

      <Space>
        <Button loading={fetching} onClick={handleFetchNow} disabled={!canEdit}>
          立即拉取（测试/补拉）
        </Button>
      </Space>

      {state.lastResult ? (
        <Alert
          type={alertType || 'info'}
          showIcon
          title={`上次拉取：${lastResultText || state.lastResult}（${state.lastFetchAt || ''}）`}
        />
      ) : (
        <Alert type="info" showIcon title="尚未拉取过" />
      )}
    </div>
  )
}
