import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Input, Typography } from 'antd'
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
  const [readDirty, setReadDirty] = useState(false)
  const [fullDirty, setFullDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadKeys = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getMcpSharedKeys()
      const k = data.keys || null
      setKeys(k)
      // 密文前缀只展示，不放入编辑框（避免误把密文当明文再保存）
      setReadKey('')
      setFullKey('')
      setReadDirty(false)
      setFullDirty(false)
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
    if (readDirty && readKey.trim()) input.read = readKey.trim()
    if (fullDirty && fullKey.trim()) input.full = fullKey.trim()
    if (!input.read && !input.full) {
      message.warning('请至少填写一个密钥值')
      return
    }
    setSaving(true)
    try {
      const data = await updateMcpSharedKeys(input)
      setKeys(data.keys || null)
      setReadKey('')
      setFullKey('')
      setReadDirty(false)
      setFullDirty(false)
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
          {keys?.read && !readDirty && (
            <Text code className="mb-1 block text-sm text-green-600">
              {keys.read}（已配置）
            </Text>
          )}
          <Input.Password
            value={readKey}
            onChange={(e) => {
              setReadKey(e.target.value)
              setReadDirty(true)
            }}
            placeholder={keys?.read ? '已配置，如需更换请输入新密钥' : '粘贴 mcp:read scope 的 API Key（fi_live_...）'}
            disabled={!canEdit}
          />
          <Text type="secondary" className="mt-1 block text-xs">
            客户信息自动脱敏，适合日常查询场景
          </Text>
        </div>

        <div>
          <Text className="mb-1 block">完整模式密钥（mcp:full）</Text>
          {keys?.full && !fullDirty && (
            <Text code className="mb-1 block text-sm text-green-600">
              {keys.full}（已配置）
            </Text>
          )}
          <Input.Password
            value={fullKey}
            onChange={(e) => {
              setFullKey(e.target.value)
              setFullDirty(true)
            }}
            placeholder={keys?.full ? '已配置，如需更换请输入新密钥' : '粘贴 mcp:full scope 的 API Key（fi_live_...）'}
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
