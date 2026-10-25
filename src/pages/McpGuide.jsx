import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Modal,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  ApiOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  EyeOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { getMcpSharedKeys, revealMcpKey } from '../lib/mcpClient.js'

const { Title, Text, Link: AntLink } = Typography

/** @typedef {{ read: string; full: string } | null} McpKeys */

const TOOLS = [
  {
    name: 'search_tickets',
    scope: 'mcp:read',
    desc: '搜索投诉/咨询工单，支持按产品、客户、标签、关键词、月份筛选',
    phase: 'P0',
  },
  {
    name: 'get_ticket_detail',
    scope: 'mcp:read',
    desc: '获取单条工单全量详情（含标签、行动建议关联）',
    phase: 'P0',
  },
  {
    name: 'get_post_use_ratings',
    scope: 'mcp:read',
    desc: '查询用后即评满意度记录，含统计摘要（均分/低分/分布）',
    phase: 'P0',
  },
  {
    name: 'get_insight_stats',
    scope: 'mcp:read',
    desc: '获取洞察统计：月度汇总/满意度趋势/状态趋势/周期列表',
    phase: 'P0',
  },
  {
    name: 'get_taxonomy',
    scope: 'mcp:read',
    desc: '获取分类法/标签库（产品体系、旅程模板、问题类型）',
    phase: 'P0',
  },
  {
    name: 'get_ticket_todos',
    scope: 'mcp:read',
    desc: '查询会议待办清单，按产品/状态/经办人筛选',
    phase: 'P0',
  },
  {
    name: 'get_action_items',
    scope: 'mcp:read',
    desc: '查询行动建议/举措清单，按产品/状态/来源/工单号筛选',
    phase: 'P1',
  },
  {
    name: 'get_action_stats',
    scope: 'mcp:read',
    desc: '行动建议统计：按状态汇总、按产品维度分组',
    phase: 'P1',
  },
  {
    name: 'get_post_use_trace',
    scope: 'mcp:read',
    desc: '查询产品部回访记录（visit 模式）',
    phase: 'P1',
  },
]

const SCOPES = [
  {
    name: 'mcp:read',
    label: '脱敏模式',
    desc: '客户信息（名称、编码、登录账号）自动脱敏为 ***，密码和 IP 正则替换',
    color: 'blue',
  },
  {
    name: 'mcp:full',
    label: '完整模式',
    desc: '可传 desensitize: false 关闭脱敏，获取真实客户名称用于跨数据源关联',
    color: 'gold',
  },
]

const FAQ = [
  {
    q: '连接失败怎么办？',
    a: '检查：① 网络能否访问服务器 3002 端口；② API Key 是否已吊销或过期；③ Authorization 头格式是否正确（Bearer + 空格 + 密钥）。',
  },
  {
    q: '客户名称显示为 *** 怎么办？',
    a: '脱敏模式下客户信息自动脱敏。如需查看真实客户名称，使用完整模式密钥（mcp:full）并在 Tool 调用时传 desensitize: false。',
  },
  {
    q: '能修改/创建数据吗？',
    a: '不能。MCP 当前只提供只读查询能力，所有写入操作仍需在 Web 界面完成。',
  },
  {
    q: '返回数据有上限吗？',
    a: '有。limit 参数最大 200 条，防止 Agent 拉取全量数据影响性能。',
  },
  {
    q: '管理员还没配置共享密钥怎么办？',
    a: '请联系管理员在「设置 → MCP 共享密钥」区域配置密钥。管理员可在「设置 → 外部系统 API Key」中创建 API Key 后，将密钥粘贴到 MCP 共享密钥配置区。',
  },
]

export default function McpGuide() {
  const message = useAppMessage()
  const [keys, setKeys] = useState(/** @type {McpKeys} */ (null))
  const [loading, setLoading] = useState(false)
  const [revealModal, setRevealModal] = useState({ open: false, scope: /** @type {'read'|'full'} */ ('read') })
  const [password, setPassword] = useState('')
  const [revealedSecret, setRevealedSecret] = useState('')
  const [verifying, setVerifying] = useState(false)

  const loadKeys = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getMcpSharedKeys()
      setKeys(data.keys || null)
    } catch (err) {
      setKeys(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const sseUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'https://<server-host>:3002/sse'
    return `${window.location.protocol}//${window.location.hostname}:3002/sse`
  }, [])

  const handleReveal = async () => {
    if (!password) {
      message.warning('请输入登录密码')
      return
    }
    setVerifying(true)
    try {
      const data = await revealMcpKey({ password, scope: revealModal.scope })
      setRevealedSecret(data.secret || '')
      message.success('密码验证通过')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '验证失败')
    } finally {
      setVerifying(false)
    }
  }

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success(`${label}已复制`)
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  const openReveal = (scope) => {
    setPassword('')
    setRevealedSecret('')
    setRevealModal({ open: true, scope })
  }

  const closeReveal = () => {
    setRevealModal({ open: false, scope: 'read' })
    setPassword('')
    setRevealedSecret('')
  }

  const currentKey = keys ? keys[revealModal.scope] : ''

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* 页面标题 */}
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
          <ApiOutlined className="text-lg" />
        </span>
        <div>
          <Title level={4} className="!mb-0">MCP 数据服务</Title>
          <Text type="secondary" className="text-sm">
            通过 MCP 协议将反馈数据提供给 AI Agent 查询
          </Text>
        </div>
      </div>

      {/* 快速接入 */}
      <Card className="!border-brand-200" styles={{ body: { padding: 24 } }}>
        <div className="mb-4 flex items-center gap-2">
          <ThunderboltOutlined className="text-brand-600" />
          <Title level={5} className="!mb-0">快速接入</Title>
        </div>

        {/* 第 1 步：连接地址 */}
        <div className="mb-5">
          <Text strong className="mb-2 block">第 1 步：获取连接地址</Text>
          <div className="flex items-center gap-2">
            <Input value={sseUrl} readOnly className="font-mono text-sm" style={{ flex: 1 }} />
            <Button icon={<CopyOutlined />} onClick={() => void copyText(sseUrl, '连接地址')}>
              复制
            </Button>
          </div>
          <Text type="secondary" className="mt-1 block text-xs">
            Agent 通过此 SSE 地址连接 MCP Server，地址根据当前服务器自动生成
          </Text>
        </div>

        {/* 第 2 步：获取 API Key */}
        <div className="mb-5">
          <Text strong className="mb-2 block">第 2 步：获取密钥</Text>
          {!keys || (!keys.read && !keys.full) ? (
            <Alert
              type="warning"
              showIcon
              message="管理员尚未配置共享密钥"
              description="请联系管理员在「设置 → MCP 共享密钥」区域配置密钥后，此页面将自动显示。"
            />
          ) : (
            <Row gutter={[16, 16]}>
              {/* 脱敏模式密钥 */}
              {keys.read && (
                <Col span={12}>
                  <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <Tag color="blue" className="!m-0">脱敏模式</Tag>
                      <Tooltip title="点击查看明文（需密码验证）">
                        <Button
                          type="text"
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => openReveal('read')}
                        >
                          显示
                        </Button>
                      </Tooltip>
                    </div>
                    <Text code className="text-sm break-all">
                      {keys.read}
                    </Text>
                    <Text type="secondary" className="mt-1 block text-xs">
                      客户信息自动脱敏，适合日常查询
                    </Text>
                  </div>
                </Col>
              )}
              {/* 完整模式密钥 */}
              {keys.full && (
                <Col span={12}>
                  <div className="rounded-lg border border-gold-200 bg-amber-50/50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <Tag color="gold" className="!m-0">完整模式</Tag>
                      <Tooltip title="点击查看明文（需密码验证）">
                        <Button
                          type="text"
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => openReveal('full')}
                        >
                          显示
                        </Button>
                      </Tooltip>
                    </div>
                    <Text code className="text-sm break-all">
                      {keys.full}
                    </Text>
                    <Text type="secondary" className="mt-1 block text-xs">
                      可关闭脱敏，用于客户跨源关联
                    </Text>
                  </div>
                </Col>
              )}
            </Row>
          )}
          <Text type="secondary" className="mt-2 block text-xs">
            密钥默认密文展示，点击「显示」后需输入登录密码验证身份才能查看完整密钥
          </Text>
        </div>

        {/* 第 3 步：配置 Agent */}
        <div>
          <Text strong className="mb-2 block">第 3 步：配置 Agent</Text>
          <Text type="secondary" className="mb-2 block text-sm">
            以 Claude Desktop 为例，编辑配置文件后重启 Agent 即可使用：
          </Text>
          <div className="relative rounded-lg bg-gray-900 p-4">
            <Button
              type="text"
              size="small"
              className="!absolute right-2 top-2 !text-gray-400"
              icon={<CopyOutlined />}
              onClick={() => void copyText(
                JSON.stringify(
                  {
                    mcpServers: {
                      'feedback-insights': {
                        url: sseUrl,
                        headers: { Authorization: 'Bearer 粘贴你的密钥' },
                      },
                    },
                  },
                  null,
                  2,
                ),
                '配置示例',
              )}
            >
              复制
            </Button>
            <pre className="overflow-x-auto text-xs leading-relaxed text-gray-300">
{`{
  "mcpServers": {
    "feedback-insights": {
      "url": "${sseUrl}",
      "headers": {
        "Authorization": "Bearer 粘贴你的密钥"
      }
    }
  }
}`}
            </pre>
          </div>
          <Text type="secondary" className="mt-1 block text-xs">
            <AntLink href="https://modelcontextprotocol.io" target="_blank">
              了解 MCP 协议 ↗
            </AntLink>
            {' · '}
            <AntLink href="https://modelcontextprotocol.io/docs/concepts/tools" target="_blank">
              了解 Tool 调用方式 ↗
            </AntLink>
          </Text>
        </div>
      </Card>

      {/* Tool 清单 */}
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <ApiOutlined className="text-brand-600" />
          <Title level={5} className="!mb-0">可用 Tool 清单（{TOOLS.length} 个）</Title>
        </div>
        <Row gutter={[12, 12]}>
          {TOOLS.map((tool) => (
            <Col key={tool.name} xs={24} sm={12} lg={8}>
              <div className="rounded-lg border border-ink-100 p-3 transition-colors hover:border-brand-300">
                <div className="mb-1 flex items-center justify-between">
                  <Text code className="text-xs font-semibold">{tool.name}</Text>
                  <Tag
                    color={tool.phase === 'P0' ? 'green' : 'orange'}
                    className="!m-0 !text-[10px]"
                  >
                    {tool.phase}
                  </Tag>
                </div>
                <Text type="secondary" className="text-xs leading-relaxed">
                  {tool.desc}
                </Text>
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 权限与认证 */}
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <LockOutlined className="text-brand-600" />
          <Title level={5} className="!mb-0">权限与认证</Title>
        </div>
        <Row gutter={[16, 16]}>
          {SCOPES.map((scope) => (
            <Col key={scope.name} xs={24} sm={12}>
              <div className="rounded-lg border border-ink-100 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Tag color={scope.color} className="!m-0">{scope.name}</Tag>
                  <Text strong>{scope.label}</Text>
                </div>
                <Text type="secondary" className="text-sm leading-relaxed">
                  {scope.desc}
                </Text>
              </div>
            </Col>
          ))}
        </Row>
        <Alert
          type="info"
          showIcon
          className="mt-3"
          message="脱敏不影响搜索"
          description="无论是否脱敏，搜索参数中填写的客户名称都会用真实值匹配。脱敏仅影响返回结果中的客户信息展示。"
        />
      </Card>

      {/* 安全约束 */}
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <SafetyCertificateOutlined className="text-brand-600" />
          <Title level={5} className="!mb-0">安全约束</Title>
        </div>
        <Space direction="vertical" size={8}>
          {[
            '只读：MCP 不提供任何写入/修改/删除操作，所有 Tool 均为 GET 语义',
            '脱敏优先：脱敏模式密钥下客户信息自动脱敏，完整模式密钥可选择性关闭',
            '结果集上限：limit 参数最大 200 条，防止拉取全量数据影响性能',
            'HTTPS 加密：服务器部署后建议配置 TLS 证书，确保传输加密',
            '审计日志：每次调用记录 API Key ID + Tool 名 + 时间戳',
          ].map((item) => (
            <div key={item} className="flex items-start gap-2">
              <CheckCircleOutlined className="mt-0.5 shrink-0 text-green-600" />
              <Text className="text-sm">{item}</Text>
            </div>
          ))}
        </Space>
      </Card>

      {/* FAQ */}
      <Card>
        <Title level={5} className="!mb-4">常见问题</Title>
        <Space direction="vertical" size={12} className="w-full">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-lg bg-ink-50 p-3">
              <Text strong className="mb-1 block text-sm">{item.q}</Text>
              <Text type="secondary" className="text-sm leading-relaxed">{item.a}</Text>
            </div>
          ))}
        </Space>
      </Card>

      {/* 密码验证弹窗 */}
      <Modal
        title="验证身份"
        open={revealModal.open}
        onCancel={closeReveal}
        footer={
          revealedSecret ? (
            <Space>
              <Button
                type="primary"
                icon={<CopyOutlined />}
                onClick={() => void copyText(revealedSecret, '密钥')}
              >
                复制密钥
              </Button>
              <Button onClick={closeReveal}>关闭</Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={closeReveal}>取消</Button>
              <Button type="primary" loading={verifying} onClick={() => void handleReveal()}>
                验证
              </Button>
            </Space>
          )
        }
        destroyOnClose
      >
        {revealedSecret ? (
          <div className="space-y-3">
            <Alert
              type="warning"
              showIcon
              message="请立即复制密钥，关闭后将无法再次查看"
            />
            <Input.TextArea
              value={revealedSecret}
              readOnly
              autoSize={{ minRows: 2, maxRows: 4 }}
              className="font-mono"
            />
            <Text type="secondary" className="text-xs">
              {revealModal.scope === 'read' ? '脱敏模式密钥（mcp:read）' : '完整模式密钥（mcp:full）'}
            </Text>
          </div>
        ) : (
          <div className="space-y-3">
            <Text className="block">
              为保护密钥安全，请输入您的登录密码以验证身份。
            </Text>
            <Text type="secondary" className="block text-xs">
              查看密钥类型：{revealModal.scope === 'read' ? '脱敏模式（mcp:read）' : '完整模式（mcp:full）'}
              {currentKey && ` · 当前密文：${currentKey}`}
            </Text>
            <Input.Password
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入登录密码"
              onPressEnter={() => void handleReveal()}
              autoFocus
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
