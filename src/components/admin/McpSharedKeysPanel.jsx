import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Input, Space, Typography } from 'antd'
import { ApiOutlined, SaveOutlined } from '@ant-design/icons'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { getMcpSharedKeys, updateMcpSharedKeys } from '../../lib/mcpClient.js'

const { Text } = Typography

/**
 * @typedef {{ read: string; full: string } | null} McpKeys
 */

export default function McpSharedKeysPanel({ canEdit }) {
  const message = useAppMessage()
  const [keys, setKeys] = useState(/** @type {McpKeys} */ (null))
  const [readKey, setReadKey] = useState('')
  const [fullKey, setFullKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadKeys = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getMcpSharedKeys()
      const k = data.keys || null
      setKeys(k)
      setReadKey(k?.read || '')
      setFullKey(k?.full || '')
    } catch (err) {
      setKeys(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const handleSave = async () => {
    const input = {}
    if (readKey.trim()) input.read = readKey.trim()
    if (fullKey.trim()) input.full = fullKey.trim()
    if (!input.read && !input.full) {
      message.warning('请至少填写一个密钥值')
      return
    }
    setSaving(true)
    try {
      const data = await updateMcpSharedKeys(input)
      setKeys(data.keys || null)
      setReadKey(data.keys?.read || '')
      setFullKey(data.keys?.full || '')
      message.success('MCP 共享密钥已保存')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-card">
      <div className="page-card-header">
        <span className="page-card-title">
          <span className="inline-flex items-center gap-2">
            <ApiOutlined />
            MCP 共享密钥
          </span>
        </span>
        <div>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            disabled={!canEdit}
            loading={saving}
            onClick={() => void handleSave()}
          >
            保存
          </Button>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        className="mb-4"
        message="MCP 共享密钥用于 Agent 对接"
        description={
          <span>
            管理员在此配置两个共享密钥，配置后「MCP 数据服务」页面将自动展示给所有用户。
            建议在上方「外部系统 API Key」中创建 scope 为 mcp:read 和 mcp:full 的密钥，
            然后将密钥粘贴到下方。
          </span>
        }
      />

      <div className="space-y-4">
        <div>
          <Text className="mb-1 block">脱敏模式密钥（mcp:read）</Text>
          <Input.Password
            value={readKey}
            onChange={(e) => setReadKey(e.target.value)}
            placeholder="粘贴 mcp:read scope 的 API Key（fi_live_...）"
            disabled={!canEdit}
          />
          <Text type="secondary" className="mt-1 block text-xs">
            客户信息自动脱敏，适合日常查询场景
          </Text>
        </div>

        <div>
          <Text className="mb-1 block">完整模式密钥（mcp:full）</Text>
          <Input.Password
            value={fullKey}
            onChange={(e) => setFullKey(e.target.value)}
            placeholder="粘贴 mcp:full scope 的 API Key（fi_live_...）"
            disabled={!canEdit}
          />
          <Text type="secondary" className="mt-1 block text-xs">
            可关闭脱敏获取真实客户名称，适合跨数据源关联场景
          </Text>
        </div>
      </div>
    </div>
  )
}
