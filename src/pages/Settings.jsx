import { Link } from 'react-router-dom'
import { Alert, Button, Card, Checkbox, Input, Radio, Space, Typography, Upload } from 'antd'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { PageHeader } from './Dashboard.shared.jsx'
import { downloadCsv, downloadJson } from '../lib/export.js'
import ProductOrderVolumePanel from '../components/ProductOrderVolumePanel.jsx'
import QuoteExtractionSettings from '../components/QuoteExtractionSettings.jsx'
import PermissionGate from '../components/auth/PermissionGate.jsx'
import { canUseSemanticMatch } from '../lib/themeSemantic.js'

const JOURNEY_MATCH_OPTIONS = [
  { value: 'keyword', label: '仅关键词', desc: '最快；按「用户旅程」二级环节的参考关键词匹配' },
  { value: 'description', label: '解释 + 关键词', desc: '本地智能匹配，综合环节说明与关键词，无需 API' },
  {
    value: 'hybrid',
    label: '混合（解释+关键词 + LLM）',
    desc: '推荐：先本地匹配用户旅程，再由 LLM 按环节说明修正；需配置大模型',
  },
  {
    value: 'semantic',
    label: '仅 LLM 语义',
    desc: '用户旅程由大模型根据处理意见判定；需配置大模型',
  },
]

function llmConfigSource(settings) {
  if (settings.llmServerConfigured) return 'server'
  if (settings.llmApiKey?.trim()) return 'client'
  return 'none'
}

/**
 * @param {Object} props
 * @param {import('../lib/storage.js').AppSettings} props.settings
 * @param {(patch: Partial<import('../lib/storage.js').AppSettings>) => void} props.onChange
 */
function LlmSettingsPanel({ settings, onChange }) {
  return (
    <div className="space-y-3">
      <Typography.Text type="secondary" className="block text-xs">
        仅保存在<strong>本浏览器</strong>，不会修改团队共享库，也不会让其他用户使用你的 API Key。
        生产环境若已配置服务端 <code className="text-xs">LLM_API_KEY</code>，所有人优先用服务端密钥。
      </Typography.Text>
      {llmConfigSource(settings) === 'server' && (
        <Alert
          type="success"
          showIcon
          title="大模型已由服务端配置（LLM_API_KEY）"
          description="下方 API 地址与模型仅影响本机发出的请求参数；个人 API Key 不会用于请求。"
        />
      )}
      {llmConfigSource(settings) === 'client' && (
        <Alert
          type="success"
          showIcon
          title="使用本机 API Key"
          description="服务端未配置 LLM_API_KEY 时，仅本浏览器发起的 LLM 请求会使用下方密钥。"
        />
      )}
      {llmConfigSource(settings) === 'none' && (
        <Alert
          type="warning"
          showIcon
          title="大模型未配置"
          description="请由管理员配置服务端 LLM_API_KEY，或在本机填写 API Key（仅本浏览器有效）。"
        />
      )}
      {!settings.llmServerConfigured && (
        <div>
          <Typography.Text strong className="mb-1 block text-xs">
            API Key（本机，可选）
          </Typography.Text>
          <Input.Password
            placeholder="sk-…"
            value={settings.llmApiKey || ''}
            onChange={(e) => onChange({ llmApiKey: e.target.value })}
            autoComplete="off"
          />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Typography.Text strong className="mb-1 block text-xs">API 地址</Typography.Text>
          <Input
            placeholder="https://api.siliconflow.cn/v1"
            value={settings.llmBaseUrl}
            onChange={(e) => onChange({ llmBaseUrl: e.target.value })}
          />
        </div>
        <div>
          <Typography.Text strong className="mb-1 block text-xs">模型</Typography.Text>
          <Input
            placeholder="deepseek-ai/DeepSeek-V3.2"
            value={settings.llmModel}
            onChange={(e) => onChange({ llmModel: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const message = useAppMessage()
  const { can } = useAuth()
  const {
    feedbacks,
    settings,
    setPersonalSettings,
    setTeamSettings,
    reprocessAllCustomerQuotes,
    reprocessing,
    clearAll,
    replaceAll,
    orderVolumes,
    orderVolumesLoading,
    saveOrderVolume,
  } = useInsights()

  const importJson = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        if (Array.isArray(data)) {
          replaceAll(data)
          alert(`已导入 ${data.length} 条反馈`)
        } else {
          alert('JSON 格式应为反馈数组')
        }
      } catch {
        alert('JSON 解析失败')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div>
      <PageHeader
        title="设置"
        desc="大模型为本机配置；团队分析规则与数据备份仅管理员可改。洞察周期请在工作台或反馈库顶栏切换。标签库请在「标签管理」维护。"
      />

      <div className="mt-6 space-y-6 max-w-2xl">
        <PermissionGate permission="configureLlmPersonal">
          <Card title="大模型配置（本机）">
            <LlmSettingsPanel settings={settings} onChange={setPersonalSettings} />
          </Card>
        </PermissionGate>

        <PermissionGate permission="manageTeamSettings">
          <Card title="旅程打标">
            <Checkbox
              checked={settings.useRequestNodeForJourney === true}
              onChange={(e) => setTeamSettings({ useRequestNodeForJourney: e.target.checked })}
            >
              正文无法识别时，用「请求节点」作兜底
            </Checkbox>
            <Typography.Text type="secondary" className="mt-2 block text-xs">
              团队共享设置，保存后其他用户约 5 秒内同步。
            </Typography.Text>
          </Card>

          <Card title="用户旅程匹配方式">
            <Typography.Text type="secondary" className="mb-3 block text-xs">
              旅程环节在{' '}
              <Link to="/tags?tab=journey">标签管理 → 用户旅程</Link>{' '}
              维护。修改后可在 <Link to="/feedbacks">反馈库</Link> 批量重新打标。
            </Typography.Text>
            <Radio.Group
              className="w-full"
              value={settings.themeMatchMode}
              onChange={(e) => setTeamSettings({ themeMatchMode: e.target.value })}
            >
              <Space orientation="vertical" className="w-full" size={12}>
                {JOURNEY_MATCH_OPTIONS.map((opt) => (
                  <Radio
                    key={opt.value}
                    value={opt.value}
                    className="w-full rounded-lg border border-ink-200 p-3"
                  >
                    <span className="text-sm font-medium text-ink-900">{opt.label}</span>
                    <Typography.Text type="secondary" className="mt-0.5 block text-xs">
                      {opt.desc}
                    </Typography.Text>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Card>

          <Card title="业务优化举措生成">
            <Radio.Group
              className="w-full"
              value={settings.optimizationMode || 'llm'}
              onChange={(e) => setTeamSettings({ optimizationMode: e.target.value })}
            >
              <Space orientation="vertical" className="w-full" size={12}>
                <Radio value="llm" className="w-full rounded-lg border border-ink-200 p-3">
                  <span className="text-sm font-medium text-ink-900">大模型生成具体举措（推荐）</span>
                </Radio>
                <Radio value="rules" className="w-full rounded-lg border border-ink-200 p-3">
                  <span className="text-sm font-medium text-ink-900">本地规则 + Playbook</span>
                </Radio>
              </Space>
            </Radio.Group>
          </Card>

          <Card title="综合概述 · 周期洞察概览">
            <Checkbox
              checked={settings.overviewConclusionsLlm === true}
              onChange={(e) => setTeamSettings({ overviewConclusionsLlm: e.target.checked })}
            >
              生成/刷新洞察快照时，自动用 LLM 润色周期洞察概览
            </Checkbox>
            <Checkbox
              className="mt-3"
              checked={settings.overviewPolishIncludeRecommendations !== false}
              disabled={!settings.overviewConclusionsLlm}
              onChange={(e) =>
                setTeamSettings({ overviewPolishIncludeRecommendations: e.target.checked })
              }
            >
              自动润色时一并润色行动建议
            </Checkbox>
          </Card>

          <PermissionGate permission="manageTeamSettings">
            <Card title="分析规则 · 客户原话抽取">
              <QuoteExtractionSettings
                settings={settings}
                feedbacks={feedbacks}
                onTeamChange={setTeamSettings}
                reprocessing={reprocessing}
                onMessage={(text) => {
                  if (text.includes('没有')) message.info(text)
                  else message.success(text)
                }}
                onReprocessAll={async () => {
                  let hide = () => {}
                  try {
                    hide = message.loading('正在重算客户原话…', 0)
                    const count = await reprocessAllCustomerQuotes((text) => {
                      hide()
                      hide = message.loading(text, 0)
                    })
                    hide()
                    hide = () => {}
                    message.success(
                      `已重算并保存 ${count ?? 0} 条客户原话；洞察快照将在后台刷新（约数秒）`,
                      5,
                    )
                  } catch (err) {
                    hide()
                    message.error(err instanceof Error ? err.message : '重算客户原话失败')
                    throw err
                  }
                }}
              />
            </Card>
          </PermissionGate>

          <Card title="导出数据">
            <Typography.Text type="secondary" className="text-xs">
              当前共 {feedbacks.length} 条反馈
            </Typography.Text>
            <Space wrap className="mt-4">
              <Button
                type="primary"
                disabled={!feedbacks.length}
                onClick={() => downloadCsv(feedbacks)}
              >
                导出 CSV
              </Button>
              <Button
                disabled={!feedbacks.length}
                onClick={() => downloadJson(feedbacks, 'feedback-insights-backup.json')}
              >
                导出 JSON 备份
              </Button>
            </Space>
          </Card>

          <Card title="导入备份">
            <Typography.Text type="secondary" className="text-xs">
              从 JSON 备份恢复（将覆盖当前数据）
            </Typography.Text>
            <div className="mt-4">
              <Upload
                accept=".json"
                showUploadList={false}
                beforeUpload={(file) => {
                  importJson(file)
                  return false
                }}
              >
                <Button>选择 JSON 文件</Button>
              </Upload>
            </div>
          </Card>
        </PermissionGate>

        {!can('manageTeamSettings') && !can('editOrderVolumes') && (
          <Alert
            type="info"
            showIcon
            message="团队分析规则与数据备份"
            description="旅程匹配、分析规则、导入导出备份等仅管理员可修改。如需调整请联系管理员。"
          />
        )}

        <PermissionGate permission="editOrderVolumes">
          <ProductOrderVolumePanel
            orderVolumes={orderVolumes}
            onSave={saveOrderVolume}
            loading={orderVolumesLoading}
          />
        </PermissionGate>

        <PermissionGate permission="deleteData">
          <Card title={<span className="text-red-700">危险操作</span>} className="border-red-200">
            <Typography.Text type="secondary" className="text-xs">
              清空已导入的反馈、洞察快照、分析记录与待复核标签
            </Typography.Text>
            <div className="mt-4">
              <Button
                danger
                onClick={async () => {
                  if (!confirm('确定清空全部反馈数据？此操作不可撤销。')) return
                  await clearAll()
                  message.success('已清空全部已导入反馈')
                }}
              >
                清空全部数据
              </Button>
            </div>
          </Card>
        </PermissionGate>
      </div>
    </div>
  )
}
