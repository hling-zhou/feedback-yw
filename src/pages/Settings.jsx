import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Card, Checkbox, Input, Modal, Radio, Select, Space, Typography, Upload } from 'antd'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { PageHeader } from './Dashboard.shared.jsx'
import { downloadFeedbackBackupJson, parseFeedbackBackupJson } from '../lib/feedbackBackup.js'
import { downloadTicketAnalysisExcel } from '../lib/ticketAnalysisExport.js'
import ProductOrderVolumePanel from '../components/ProductOrderVolumePanel.jsx'
import PermissionGate from '../components/auth/PermissionGate.jsx'
import { canUseSemanticMatch } from '../lib/themeSemantic.js'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'
import {
  describeClearImportedScope,
  describeClearImportedScopeRisk,
  validateScopedClearOptions,
} from '../storage/clearImportedData.js'

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
          description="API 地址与模型留空时，使用服务端环境变量 LLM_BASE_URL / LLM_MODEL；填写则仅覆盖本机请求参数。个人 API Key 不会用于请求。"
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
            value={settings.llmBaseUrl || ''}
            onChange={(e) => onChange({ llmBaseUrl: e.target.value })}
          />
          <Typography.Text type="secondary" className="mt-1 block text-xs">
            留空则使用服务端 LLM_BASE_URL（若已配置）
          </Typography.Text>
        </div>
        <div>
          <Typography.Text strong className="mb-1 block text-xs">模型</Typography.Text>
          <Input
            placeholder="deepseek-ai/DeepSeek-V3.2"
            value={settings.llmModel || ''}
            onChange={(e) => onChange({ llmModel: e.target.value })}
          />
          <Typography.Text type="secondary" className="mt-1 block text-xs">
            留空则使用服务端 LLM_MODEL（若已配置）
          </Typography.Text>
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
    clearAll,
    clearImportedData,
    replaceAll,
    orderVolumes,
    orderVolumesLoading,
    saveOrderVolume,
  } = useInsights()

  const [clearPeriodId, setClearPeriodId] = useState('')
  /** @type {import('../domain/insightPeriod.js').InsightPeriod | null} */
  const [clearPeriod, setClearPeriod] = useState(null)
  const [clearSourceType, setClearSourceType] = useState('')
  const [clearing, setClearing] = useState(false)

  const buildScopedClearOptions = () => ({
    ...(clearPeriodId ? { insightPeriodId: clearPeriodId } : {}),
    ...(clearSourceType ? { dataSourceType: clearSourceType } : {}),
  })

  const importJson = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result))
        const { records, format } = parseFeedbackBackupJson(raw)
        replaceAll(records)
        const formatHint = format === 'envelope-v1' ? '（v1 信封）' : '（旧版数组）'
        message.success(`已导入 ${records.length} 条反馈${formatHint}`)
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'JSON 解析失败')
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
          <Card title="维度打标">
            <Checkbox
              checked={settings.retagDimensionsAfterTicketLlm !== false}
              onChange={(e) =>
                setTeamSettings({ retagDimensionsAfterTicketLlm: e.target.checked })
              }
            >
              工单 LLM 成功后，按 LLM 客户请求/痛点重打请求场景与问题类型
            </Checkbox>
            <Typography.Text type="secondary" className="mt-2 block text-xs">
              默认开启。仅对本次 ticket LLM 成功写入客户请求或痛点的工单生效；尊重工单详情中人工保存的标签维度。
            </Typography.Text>
          </Card>

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
              请求场景、投诉/咨询工单的问题类型始终为本地规则打标，不受此项影响。
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
            <Typography.Text type="secondary" className="mb-3 block text-xs">
              洞察概览 V2 行动建议的优化举措当前为规则生成；旅程 Tab 已切换为痛点聚类展示，不再调用 LLM
              旅程举措。此设置影响后续 LLM 举措扩展及工单详情中的优化文案。
            </Typography.Text>
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

          <Card title="导出数据">
            <Typography.Text type="secondary" className="text-xs">
              当前共 {feedbacks.length} 条反馈。Excel 为工单分析 v2 列（按导入月份分 Sheet）；JSON
              备份含 schema 版本与完整记录。
            </Typography.Text>
            <Space wrap className="mt-4">
              <Button
                type="primary"
                disabled={!feedbacks.length}
                onClick={() => downloadTicketAnalysisExcel(feedbacks)}
              >
                导出 Excel
              </Button>
              <Button
                disabled={!feedbacks.length}
                onClick={() => downloadFeedbackBackupJson(feedbacks)}
              >
                导出 JSON 备份
              </Button>
            </Space>
          </Card>

          <Card title="导入备份">
            <Typography.Text type="secondary" className="text-xs">
              从 JSON 备份恢复（将覆盖当前数据）。支持 v1 信封或旧版纯数组格式。
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
            <Typography.Text type="secondary" className="block text-xs">
              清空已导入的反馈、洞察快照、分析记录与待复核标签。清空「二季度投诉」请同时勾选
              <strong> 指定洞察周期（2026年Q2）+ 数据来源（投诉工单）</strong>
              ；只选其一可能误删其它月份或其它来源。全部清空请用下方独立按钮。
            </Typography.Text>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Typography.Text strong className="mb-2 block text-xs">
                    洞察周期（可选）
                  </Typography.Text>
                  <InsightPeriodPicker
                    compact
                    showHint={false}
                    allowEmpty
                    value={clearPeriodId || null}
                    onChange={(id, period) => {
                      setClearPeriodId(id || '')
                      setClearPeriod(period)
                    }}
                  />
                </div>
                <div>
                  <Typography.Text strong className="mb-1 block text-xs">
                    数据来源（可选）
                  </Typography.Text>
                  <Select
                    allowClear
                    className="w-full"
                    placeholder="不限制来源"
                    value={clearSourceType || undefined}
                    options={DATA_SOURCE_TYPES.map((t) => ({
                      label: DATA_SOURCE_LABELS[t],
                      value: t,
                    }))}
                    onChange={(v) => setClearSourceType(v || '')}
                  />
                </div>
              </div>
              <Space wrap>
                <Button
                  danger
                  loading={clearing}
                  disabled={!clearPeriodId || !clearSourceType}
                  onClick={() => {
                    const options = buildScopedClearOptions()
                    const validationError = validateScopedClearOptions(options)
                    if (validationError) {
                      message.warning(validationError)
                      return
                    }
                    Modal.confirm({
                      title: '确定按条件清空数据？',
                      content: (
                        <div className="space-y-2">
                          <p>{describeClearImportedScope(options, clearPeriod)}</p>
                          <p>{describeClearImportedScopeRisk(options)}</p>
                          <p className="text-red-600">不可撤销，请确认范围无误。</p>
                        </div>
                      ),
                      okText: '清空',
                      okType: 'danger',
                      cancelText: '取消',
                      onOk: async () => {
                        setClearing(true)
                        try {
                          await clearImportedData(options)
                          message.success(`已清空：${describeClearImportedScope(options, clearPeriod)}`)
                          setClearPeriodId('')
                          setClearPeriod(null)
                          setClearSourceType('')
                        } catch (err) {
                          message.error(err instanceof Error ? err.message : '清空失败')
                        } finally {
                          setClearing(false)
                        }
                      },
                    })
                  }}
                >
                  清空选中范围
                </Button>
                <Button
                  danger
                  type="primary"
                  loading={clearing}
                  onClick={() => {
                    Modal.confirm({
                      title: '确定清空全部数据？',
                      content:
                        '将删除全部洞察周期、全部数据来源的反馈、快照、分析记录与待复核标签，不可撤销。',
                      okText: '全部清空',
                      okType: 'danger',
                      cancelText: '取消',
                      onOk: async () => {
                        setClearing(true)
                        try {
                          await clearAll()
                          message.success('已清空全部已导入数据')
                          setClearPeriodId('')
                          setClearPeriod(null)
                          setClearSourceType('')
                        } catch (err) {
                          message.error(err instanceof Error ? err.message : '清空失败')
                        } finally {
                          setClearing(false)
                        }
                      },
                    })
                  }}
                >
                  清空全部数据
                </Button>
              </Space>
            </div>
          </Card>
        </PermissionGate>
      </div>
    </div>
  )
}
