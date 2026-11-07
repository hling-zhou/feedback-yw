import { useEffect, useState } from 'react'
import { Alert, Button, Input, Typography } from 'antd'
import { apiFetch } from '../lib/apiClient.js'
import { useAppMessage } from '../hooks/useAppMessage.js'
import FieldLabel from './FieldLabel.jsx'

/**
 * 产品API日志诊断配置面板（Settings「大模型」tab 内、与团队大模型配置并列，2026-11-07 拍板）。
 * 存储 meta api_patrol_mcp_config_v1；token 脱敏读（GET /api/patrol/admin/mcp-config）、
 * 留空保留现有（服务端 PUT 特判合并，与 llm_config_v1 同构）。
 * 解析链：库 > 环境变量 PATROL_MCP_ENDPOINT/PATROL_MCP_TOKEN；诊断触发时 admin/process 显式传参优先。
 *
 * @param {Object} props
 * @param {boolean} props.canEdit - 仅管理员（managePatrolMcpConfig）
 */
export default function PatrolMcpSettingsPanel({ canEdit }) {
  const message = useAppMessage()
  /** @type {[{mcpEndpoint: string, mcpToken: string}, import('react').Dispatch<any>]} */
  // @ts-ignore — useState 联合类型推断过宽，运行时为对象
  const [draft, setDraft] = useState(() => ({ mcpEndpoint: '', mcpToken: '' }))
  /** @type {[any, import('react').Dispatch<any>]} */
  // @ts-ignore — 同上
  const [serverStatus, setServerStatus] = useState(null)
  const [saving, setSaving] = useState(false)

  const loadConfig = async () => {
    try {
      const data = await apiFetch('/api/patrol/admin/mcp-config')
      setServerStatus({
        source: data.source,
        mcpEndpoint: data.mcpEndpoint || '',
        tokenMasked: data.tokenMasked || '',
        tokenConfigured: Boolean(data.tokenConfigured),
        updatedBy: data.updatedBy || '',
        updatedAt: data.updatedAt || '',
      })
      setDraft((prev) => ({ ...prev, mcpEndpoint: data.mcpEndpoint || '' }))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '读取诊断配置失败')
    }
  }

  useEffect(() => {
    loadConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const source = serverStatus?.source ?? 'none'

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiFetch('/api/storage/meta/api_patrol_mcp_config_v1', {
        method: 'PUT',
        body: JSON.stringify({
          value: {
            mcpEndpoint: draft.mcpEndpoint || '',
            // mcpToken 留空表示保留现有 token（服务端合并）
            mcpToken: draft.mcpToken || undefined,
          },
        }),
      })
      message.success('已保存产品API日志诊断配置')
      setDraft((prev) => ({ ...prev, mcpToken: '' }))
      await loadConfig()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <Typography.Text type="secondary" className="block text-xs">
        产品API巡检失败请求的日志诊断服务（云网工作台 MCP），<strong>仅管理员可改</strong>；保存后全团队生效，
        存于服务端数据库，<strong>库优先于环境变量</strong>（
        <code className="text-xs">PATROL_MCP_ENDPOINT</code> / <code className="text-xs">PATROL_MCP_TOKEN</code>）。
      </Typography.Text>

      {source === 'db' && (
        <Alert
          type="success"
          showIcon
          title="当前由数据库配置生效"
          description={`诊断端点已配置${serverStatus?.tokenConfigured ? `（token ${serverStatus?.tokenMasked}）` : '（未配置 token）'}；诊断由管理员在巡检模块触发，端点未就绪时自动跳过。`}
        />
      )}
      {source === 'env' && (
        <Alert
          type="info"
          showIcon
          title="当前由环境变量兜底"
          description="数据库未配置端点，正在使用服务端 PATROL_MCP_ENDPOINT。管理员可在此保存以固化到数据库。"
        />
      )}
      {source === 'none' && (
        <Alert
          type="warning"
          showIcon
          title="诊断服务未配置"
          description="数据库与环境变量均未配置 MCP 端点；触发诊断将跳过，失败组保持「未诊断」状态。"
        />
      )}

      <div>
        <FieldLabel hint="云网工作台 MCP 服务地址">MCP 诊断端点</FieldLabel>
        <Input
          placeholder="http://cni.api.mcp:31788/mcp"
          value={draft.mcpEndpoint}
          onChange={(e) => setDraft((prev) => ({ ...prev, mcpEndpoint: e.target.value }))}
          disabled={!canEdit}
        />
        <Typography.Text type="secondary" className="mt-1 block text-xs">
          生产口径见《API巡检-外部对接指南》§8 网络开通清单：10.233.1.22:8080/mcp-server 或 cni.api.mcp:31788/mcp（以平台组确认为准）
        </Typography.Text>
      </div>
      <div>
        <FieldLabel
          hint={
            source !== 'none' && serverStatus?.tokenConfigured
              ? `当前 ${serverStatus?.tokenMasked}；留空保留`
              : '云网工作台 → 通用智能体 → 设置 → MCP 工具面板 → 生成 token'
          }
        >
          MCP 访问 Token
        </FieldLabel>
        <Input.Password
          placeholder={serverStatus?.tokenConfigured ? '留空则保留现有 token' : '粘贴个人访问 token'}
          value={draft.mcpToken}
          onChange={(e) => setDraft((prev) => ({ ...prev, mcpToken: e.target.value }))}
          autoComplete="off"
          disabled={!canEdit}
        />
      </div>
      <Button type="primary" loading={saving} onClick={handleSave} disabled={!canEdit}>
        保存诊断配置
      </Button>
    </div>
  )
}
