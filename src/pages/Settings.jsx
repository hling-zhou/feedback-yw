import { useMemo, useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Button, Card, Checkbox, Input, Modal, Radio, Select, Space, Typography, Upload } from 'antd'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { PageHeader } from './Dashboard.shared.jsx'
import { downloadFeedbackBackupJson, parseFeedbackBackupJson } from '../lib/feedbackBackup.js'
import { downloadTicketAnalysisExcel } from '../lib/ticketAnalysisExport.js'
import { fetchAllRecordPages } from '../lib/recordLoader.js'
import { listAllFeedbacks } from '../storage/feedbackStore.js'
import ProductWanTouMetricsPanel from '../components/ProductWanTouMetricsPanel.jsx'
import AuditLogPanel from '../components/admin/AuditLogPanel.jsx'
import MessageBottlePanel from '../components/admin/MessageBottlePanel.jsx'
import RequirementTicketProgressPanel from '../components/admin/RequirementTicketProgressPanel.jsx'
import ApiKeyPanel from '../components/admin/ApiKeyPanel.jsx'
import WorkbenchTabNav from '../components/workbench/WorkbenchTabNav.jsx'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'
import {
  describeClearImportedScope,
  describeClearImportedScopeRisk,
  validateScopedClearOptions,
} from '../storage/clearImportedData.js'
import { listProducts } from '../lib/productTaxonomy.js'
import { normalizeInsightPeriod, recordMatchesPeriod } from '../domain/insightPeriod.js'
import { getLlmServerConfigured, refreshLlmServerStatus } from '../lib/llmClient.js'
import {
  getVisibleSettingsTabs,
  resolveSettingsTab,
  SETTINGS_TAB_DESCRIPTIONS,
  SETTINGS_TAB_LABELS,
} from '../lib/settingsTabs.js'

/**
 * 清空数据二次确认：先展示范围，再强提醒最后确认。
 * @param {{
 *   scopeLabel: string
 *   riskText: string
 *   finalTitle?: string
 *   onConfirm: () => void | Promise<void>
 * }} params
 */
function confirmClearDataTwice({ scopeLabel, riskText, finalTitle = '最后确认：清空数据', onConfirm }) {
  Modal.confirm({
    title: '确认清空范围',
    width: 520,
    content: (
      <div className="space-y-3">
        <p className="font-medium text-ink-800">{scopeLabel}</p>
        <p className="text-sm text-ink-600">{riskText}</p>
        <Alert type="warning" showIcon message="下一步仍需再次确认，请仔细核对范围。" />
      </div>
    ),
    okText: '下一步',
    okType: 'danger',
    cancelText: '取消',
    onOk: () =>
      new Promise((resolve, reject) => {
        Modal.confirm({
          title: finalTitle,
          width: 520,
          content: (
            <div className="space-y-3">
              <Alert
                type="error"
                showIcon
                message="此操作不可撤销"
                description={
                  <>
                    <p className="mb-2">{scopeLabel}</p>
                    <p className="mb-0">{riskText}</p>
                    <p className="mb-0 mt-2 font-medium text-red-700">
                      删除后无法恢复，相关洞察快照可能需手动刷新。
                    </p>
                  </>
                }
              />
            </div>
          ),
          okText: '确认清空',
          okType: 'danger',
          cancelText: '取消',
          onOk: async () => {
            try {
              await onConfirm()
              resolve(undefined)
            } catch (err) {
              reject(err)
            }
          },
          onCancel: () => reject(new Error('cancel')),
        })
      }).catch((err) => {
        if (err instanceof Error && err.message === 'cancel') return
        throw err
      }),
  })
}

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

const CLEAR_ALL_PRODUCTS_VALUE = '__ALL_PRODUCTS__'

function llmConfigSource(settings, serverConfiguredHint) {
  if (settings.llmServerConfigured || serverConfiguredHint) return 'server'
  if (settings.llmApiKey?.trim()) return 'client'
  return 'none'
}

/**
 * @param {import('../lib/storage.js').AppSettings} settings
 */
function pickLlmDraft(settings) {
  return {
    llmApiKey: settings.llmApiKey || '',
    llmBaseUrl: settings.llmBaseUrl || '',
    llmModel: settings.llmModel || '',
  }
}

/**
 * @param {import('../lib/storage.js').AppSettings} settings
 */
function pickAnalysisDraft(settings) {
  return {
    retagDimensionsAfterTicketLlm: settings.retagDimensionsAfterTicketLlm !== false,
    useRequestNodeForJourney: settings.useRequestNodeForJourney === true,
    themeMatchMode: settings.themeMatchMode,
    optimizationMode: settings.optimizationMode || 'llm',
  }
}

/**
 * @param {Object} props
 * @param {import('../lib/storage.js').AppSettings} props.settings
 * @param {(patch: Partial<import('../lib/storage.js').AppSettings>) => void} props.onSave
 * @param {(patch: Partial<import('../lib/storage.js').AppSettings>) => void} props.onServerStatusChange
 */
function LlmSettingsPanel({ settings, onSave, onServerStatusChange }) {
  const message = useAppMessage()
  const [draft, setDraft] = useState(() => pickLlmDraft(settings))
  const [saving, setSaving] = useState(false)
  const [serverConfiguredHint, setServerConfiguredHint] = useState(
    () => settings.llmServerConfigured === true || getLlmServerConfigured() === true,
  )

  useEffect(() => {
    setDraft(pickLlmDraft(settings))
  }, [settings.llmApiKey, settings.llmBaseUrl, settings.llmModel])

  useEffect(() => {
    let cancelled = false
    refreshLlmServerStatus().then((configured) => {
      if (cancelled) return
      setServerConfiguredHint(configured)
      onServerStatusChange({ llmServerConfigured: configured })
    })
    return () => {
      cancelled = true
    }
  }, [onServerStatusChange])

  const configSource = llmConfigSource(
    { ...settings, llmApiKey: draft.llmApiKey },
    serverConfiguredHint,
  )

  const handleSave = () => {
    setSaving(true)
    try {
      onSave(draft)
      message.success('已保存大模型配置')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <Typography.Text type="secondary" className="block text-xs">
        仅保存在<strong>本浏览器</strong>，不会修改团队共享库，也不会让其他用户使用你的 API Key。
        生产环境若已配置服务端 <code className="text-xs">LLM_API_KEY</code>，所有人优先用服务端密钥。
      </Typography.Text>
      {configSource === 'server' && (
        <Alert
          type="success"
          showIcon
          title="大模型已由服务端配置（LLM_API_KEY）"
          description="API 地址与模型留空时，使用服务端环境变量 LLM_BASE_URL / LLM_MODEL；填写则仅覆盖本机请求参数。个人 API Key 不会用于请求。"
        />
      )}
      {configSource === 'client' && (
        <Alert
          type="success"
          showIcon
          title="使用本机 API Key"
          description="服务端未配置 LLM_API_KEY 时，仅本浏览器发起的 LLM 请求会使用下方密钥。"
        />
      )}
      {configSource === 'none' && (
        <Alert
          type="warning"
          showIcon
          title="大模型未配置"
          description="请由管理员配置服务端 LLM_API_KEY，或在本机填写 API Key（仅本浏览器有效）。"
        />
      )}
      {configSource !== 'server' && (
        <div>
          <Typography.Text strong className="mb-1 block text-xs">
            API Key（本机，可选）
          </Typography.Text>
          <Input.Password
            placeholder="sk-…"
            value={draft.llmApiKey}
            onChange={(e) => setDraft((prev) => ({ ...prev, llmApiKey: e.target.value }))}
            autoComplete="off"
          />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Typography.Text strong className="mb-1 block text-xs">API 地址</Typography.Text>
          <Input
            placeholder="https://api.siliconflow.cn/v1"
            value={draft.llmBaseUrl}
            onChange={(e) => setDraft((prev) => ({ ...prev, llmBaseUrl: e.target.value }))}
          />
          <Typography.Text type="secondary" className="mt-1 block text-xs">
            留空则使用服务端 LLM_BASE_URL（若已配置）
          </Typography.Text>
        </div>
        <div>
          <Typography.Text strong className="mb-1 block text-xs">模型</Typography.Text>
          <Input
            placeholder="deepseek-ai/DeepSeek-V3.2"
            value={draft.llmModel}
            onChange={(e) => setDraft((prev) => ({ ...prev, llmModel: e.target.value }))}
          />
          <Typography.Text type="secondary" className="mt-1 block text-xs">
            留空则使用服务端 LLM_MODEL（若已配置）
          </Typography.Text>
        </div>
      </div>
      <Button type="primary" loading={saving} onClick={handleSave}>
        保存大模型配置
      </Button>
    </div>
  )
}

/**
 * @param {ReturnType<typeof pickAnalysisDraft>} draft
 * @param {import('../lib/storage.js').AppSettings} settings
 */
function isAnalysisDraftDirty(draft, settings) {
  const saved = pickAnalysisDraft(settings)
  return (
    draft.retagDimensionsAfterTicketLlm !== saved.retagDimensionsAfterTicketLlm ||
    draft.useRequestNodeForJourney !== saved.useRequestNodeForJourney ||
    draft.themeMatchMode !== saved.themeMatchMode ||
    draft.optimizationMode !== saved.optimizationMode
  )
}

/**
 * @param {Object} props
 * @param {import('../lib/storage.js').AppSettings} props.settings
 * @param {(patch: Partial<import('../lib/storage.js').AppSettings>) => void} props.onSave
 */
function AnalysisSettingsPanel({ settings, onSave }) {
  const message = useAppMessage()
  const [draft, setDraft] = useState(() => pickAnalysisDraft(settings))
  const [saving, setSaving] = useState(false)
  const dirty = isAnalysisDraftDirty(draft, settings)

  useEffect(() => {
    setDraft(pickAnalysisDraft(settings))
  }, [
    settings.retagDimensionsAfterTicketLlm,
    settings.useRequestNodeForJourney,
    settings.themeMatchMode,
    settings.optimizationMode,
  ])

  const handleSave = () => {
    setSaving(true)
    try {
      onSave({
        retagDimensionsAfterTicketLlm: draft.retagDimensionsAfterTicketLlm,
        useRequestNodeForJourney: draft.useRequestNodeForJourney,
        themeMatchMode: draft.themeMatchMode,
        optimizationMode: draft.optimizationMode,
      })
      message.success('已保存分析与打标设置')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setDraft(pickAnalysisDraft(settings))
  }

  return (
    <>
      <div className={`space-y-6 ${dirty ? 'pb-20' : ''}`}>
        <Card title="维度打标">
          <Checkbox
            checked={draft.retagDimensionsAfterTicketLlm}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, retagDimensionsAfterTicketLlm: e.target.checked }))
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
            checked={draft.useRequestNodeForJourney}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, useRequestNodeForJourney: e.target.checked }))
            }
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
            <Link to="/tags?tab=journey">对象与标签 → 用户旅程</Link>{' '}
            维护。修改后可在 <Link to="/feedbacks">反馈库</Link> 批量重新打标。
            请求场景、投诉/咨询工单的问题类型始终为本地规则打标，不受此项影响。
          </Typography.Text>
          <Radio.Group
            className="w-full"
            value={draft.themeMatchMode}
            onChange={(e) => setDraft((prev) => ({ ...prev, themeMatchMode: e.target.value }))}
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

        <Card title="单条工单优化建议（导入/重打标）">
          <Typography.Text type="secondary" className="mb-3 block text-xs">
            控制导入与批量重打标时，是否为每条工单生成「产品/服务优化建议」（LLM 或规则）。
            洞察概览 V2 行动建议不走此开关：刷新洞察后由痛点聚类 + 工单优化字段聚合 + Playbook
            兜底生成；如需改写已有建议结构，请在工作台使用「LLM 润色行动建议」。
          </Typography.Text>
          <Radio.Group
            className="w-full"
            value={draft.optimizationMode}
            onChange={(e) => setDraft((prev) => ({ ...prev, optimizationMode: e.target.value }))}
          >
            <Space orientation="vertical" className="w-full" size={12}>
              <Radio value="llm" className="w-full rounded-lg border border-ink-200 p-3">
                <span className="text-sm font-medium text-ink-900">大模型生成（单条工单）</span>
                <Typography.Text type="secondary" className="mt-0.5 block text-xs">
                  导入/重打标时对每条工单调用 LLM 产出 optimization 字段
                </Typography.Text>
              </Radio>
              <Radio value="rules" className="w-full rounded-lg border border-ink-200 p-3">
                <span className="text-sm font-medium text-ink-900">本地规则 + Playbook（单条工单）</span>
                <Typography.Text type="secondary" className="mt-0.5 block text-xs">
                  不调用 LLM，按旅程/问题类型模板写入 optimization 字段
                </Typography.Text>
              </Radio>
            </Space>
          </Radio.Group>
        </Card>
      </div>

      {dirty ? (
        <div className="page-sticky-footer">
          <div className="flex max-w-2xl flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4 lg:px-5">
            <Typography.Text type="secondary" className="text-sm">
              有未保存的修改
            </Typography.Text>
            <Space wrap>
              <Button disabled={saving} onClick={handleDiscard}>
                放弃更改
              </Button>
              <Button type="primary" loading={saving} onClick={handleSave}>
                保存分析与打标设置
              </Button>
            </Space>
          </div>
        </div>
      ) : null}
    </>
  )
}

/** @param {{ tab: import('../lib/settingsTabs.js').SettingsTabKey | null }} props */
function SettingsTabIntro({ tab }) {
  if (!tab) return null
  const description = SETTINGS_TAB_DESCRIPTIONS[tab]
  if (!description) return null
  return (
    <Typography.Text type="secondary" className="mb-4 block text-sm">
      {description}
      {tab === 'analysis' ? (
        <>
          {' '}
          标签词表与用后即评重点客户名单请在 <Link to="/tags">对象与标签</Link> 维护；洞察周期请在工作台或反馈库顶栏切换。
        </>
      ) : null}
    </Typography.Text>
  )
}

export default function Settings() {
  const message = useAppMessage()
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    feedbacks,
    totalRecordCount,
    adapter,
    settings,
    setPersonalSettings,
    setTeamSettings,
    clearAll,
    clearImportedData,
    replaceAll,
    orderVolumes,
    orderVolumesLoading,
    saveOrderVolume,
    wanTouTargets,
    wanTouTargetsLoading,
    saveWanTouTarget,
  } = useInsights()

  const [clearPeriodId, setClearPeriodId] = useState('')
  /** @type {import('../domain/insightPeriod.js').InsightPeriod | null} */
  const [clearPeriod, setClearPeriod] = useState(null)
  const [clearSourceType, setClearSourceType] = useState('')
  const [clearProduct, setClearProduct] = useState('')
  const [clearing, setClearing] = useState(false)
  /** @type {[import('../lib/types.js').FeedbackRecord[] | null, import('react').Dispatch<any>]} */
  const [clearScopeRecords, setClearScopeRecords] = useState(null)
  const [exporting, setExporting] = useState(false)

  const visibleTabs = useMemo(() => getVisibleSettingsTabs(can), [can])
  const activeTab = useMemo(
    () => resolveSettingsTab(searchParams.get('tab'), visibleTabs),
    [searchParams, visibleTabs],
  )

  useEffect(() => {
    if (!activeTab) return
    if (searchParams.get('tab') === activeTab) return
    setSearchParams({ tab: activeTab }, { replace: true })
  }, [activeTab, searchParams, setSearchParams])

  // 清除面板预览：按所选周期/来源按需拉取全量范围（缓存可能仅含已加载周期）
  useEffect(() => {
    if (activeTab !== 'data') return
    let cancelled = false
    /** @type {import('../storage/adapter.js').RecordQuery} */
    const query = {}
    if (clearPeriodId) query.insightPeriodId = clearPeriodId
    if (clearSourceType) query.dataSourceType = clearSourceType
    fetchAllRecordPages(adapter, query)
      .then(({ records }) => {
        if (!cancelled) setClearScopeRecords(records)
      })
      .catch((err) => console.warn('[settings] 清除范围预览加载失败', err))
    return () => {
      cancelled = true
    }
  }, [activeTab, clearPeriodId, clearSourceType, adapter])

  /** 导出为全库语义：点击时按需拉取全部记录 */
  const handleExportAll = async (kind) => {
    setExporting(true)
    try {
      const records = await listAllFeedbacks(adapter)
      if (!records.length) {
        message.info('暂无数据可导出')
        return
      }
      if (kind === 'excel') downloadTicketAnalysisExcel(records)
      else downloadFeedbackBackupJson(records)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const clearScopeFeedbacks = useMemo(() => {
    // API 模式下 feedbacks 缓存可能仅含已加载周期；清除预览按需从存储拉取全量范围
    const base = clearScopeRecords ?? feedbacks
    if (!clearPeriod) return base
    const normalized = normalizeInsightPeriod(clearPeriod)
    return base.filter((fb) => {
      if (clearSourceType && (fb.dataSourceType || 'complaint_ticket') !== clearSourceType) {
        return false
      }
      return recordMatchesPeriod(fb, normalized)
    })
  }, [clearScopeRecords, feedbacks, clearPeriod, clearSourceType])

  const clearProductOptions = useMemo(
    () => {
      const productOptions = listProducts(clearScopeFeedbacks).map((p) => ({
        label: `${p.name}（${p.count} 条）`,
        value: p.name,
      }))
      if (!productOptions.length) return productOptions
      return [
        {
          label: `全部产品（${clearScopeFeedbacks.length} 条）`,
          value: CLEAR_ALL_PRODUCTS_VALUE,
        },
        ...productOptions,
      ]
    },
    [clearScopeFeedbacks],
  )

  const buildScopedClearOptions = () => ({
    ...(clearPeriodId ? { insightPeriodId: clearPeriodId } : {}),
    ...(clearSourceType ? { dataSourceType: clearSourceType } : {}),
    ...(clearProduct === CLEAR_ALL_PRODUCTS_VALUE ? { allProducts: true } : {}),
    ...(clearProduct && clearProduct !== CLEAR_ALL_PRODUCTS_VALUE ? { product: clearProduct } : {}),
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

  const canManageTeamSettings = can('manageTeamSettings')
  const canExportData = canManageTeamSettings || can('export')
  const canDeleteData = can('deleteData')

  const handleTabChange = (key) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  if (!visibleTabs.length) {
    return (
      <div>
        <PageHeader title="设置" desc="当前账号暂无可用的设置项。" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="设置"
        desc="按用途分组：大模型、分析规则、万投比指标、数据管理与审计。标签库请在「对象与标签」维护。"
      />

      <WorkbenchTabNav
        className="mt-6"
        activeKey={activeTab || visibleTabs[0]}
        items={visibleTabs.map((key) => ({ key, label: SETTINGS_TAB_LABELS[key] }))}
        onChange={handleTabChange}
      />

      <div
        className={`mt-4 ${
          activeTab === 'bottles' || activeTab === 'requirement_sync'
            ? ''
            : activeTab === 'metrics'
              ? 'max-w-4xl'
              : 'max-w-2xl'
        }`}
      >
        <SettingsTabIntro tab={activeTab} />

        {activeTab === 'llm' && (
          <Card title="大模型配置（本机）">
            <LlmSettingsPanel
              settings={settings}
              onSave={setPersonalSettings}
              onServerStatusChange={setPersonalSettings}
            />
          </Card>
        )}

        {activeTab === 'analysis' && canManageTeamSettings && (
          <AnalysisSettingsPanel settings={settings} onSave={setTeamSettings} />
        )}

        {activeTab === 'metrics' && can('editOrderVolumes') && (
          <ProductWanTouMetricsPanel
            orderVolumes={orderVolumes}
            wanTouTargets={wanTouTargets}
            onSaveOrderVolume={saveOrderVolume}
            onSaveWanTouTarget={saveWanTouTarget}
            loading={orderVolumesLoading || wanTouTargetsLoading}
          />
        )}

        {activeTab === 'data' && (
          <div className="space-y-6">
            {canExportData && (
              <Card title="导出数据">
                <Typography.Text type="secondary" className="text-xs">
                  当前共 {totalRecordCount || feedbacks.length} 条反馈。Excel 为工单分析 v2 列（按导入月份分 Sheet）；JSON
                  备份含 schema 版本与完整记录。
                </Typography.Text>
                <Space wrap className="mt-4">
                  <Button
                    type="primary"
                    loading={exporting}
                    disabled={!totalRecordCount && !feedbacks.length}
                    onClick={() => handleExportAll('excel')}
                  >
                    导出 Excel
                  </Button>
                  <Button
                    loading={exporting}
                    disabled={!totalRecordCount && !feedbacks.length}
                    onClick={() => handleExportAll('json')}
                  >
                    导出 JSON 备份
                  </Button>
                </Space>
              </Card>
            )}

            {canManageTeamSettings && (
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
            )}

            {canDeleteData && (
              <Card title={<span className="text-red-700">危险操作</span>} className="border-red-200">
                <Typography.Text type="secondary" className="block text-xs">
                  清空已导入的反馈、洞察快照、分析记录与待复核标签。按条件清空须同时选择
                  <strong> 洞察周期 + 数据来源</strong>
                  ，并指定<strong>单个产品或全部产品</strong>；全部清空请用下方独立按钮。
                </Typography.Text>
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Typography.Text strong className="mb-2 block text-xs">
                        洞察周期
                      </Typography.Text>
                      <InsightPeriodPicker
                        compact
                        showHint={false}
                        allowEmpty
                        value={clearPeriodId || null}
                        onChange={(id, period) => {
                          setClearPeriodId(id || '')
                          setClearPeriod(period)
                          setClearProduct('')
                        }}
                      />
                    </div>
                    <div>
                      <Typography.Text strong className="mb-1 block text-xs">
                        数据来源
                      </Typography.Text>
                      <Select
                        allowClear
                        className="w-full"
                        placeholder="请选择数据来源"
                        value={clearSourceType || undefined}
                        options={DATA_SOURCE_TYPES.map((t) => ({
                          label: DATA_SOURCE_LABELS[t],
                          value: t,
                        }))}
                        onChange={(v) => {
                          setClearSourceType(v || '')
                          setClearProduct('')
                        }}
                      />
                    </div>
                    <div>
                      <Typography.Text strong className="mb-1 block text-xs">
                        产品
                      </Typography.Text>
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        className="w-full"
                        placeholder={
                          clearPeriodId && clearSourceType ? '请选择产品或全部产品' : '请先选择周期与来源'
                        }
                        disabled={!clearPeriodId || !clearSourceType}
                        value={clearProduct || undefined}
                        options={clearProductOptions}
                        onChange={(v) => setClearProduct(v || '')}
                      />
                    </div>
                  </div>
                  <Space wrap>
                    <Button
                      danger
                      loading={clearing}
                      disabled={!clearPeriodId || !clearSourceType || !clearProduct}
                      onClick={() => {
                        const options = buildScopedClearOptions()
                        const validationError = validateScopedClearOptions(options)
                        if (validationError) {
                          message.warning(validationError)
                          return
                        }
                        const scopeLabel = describeClearImportedScope(options, clearPeriod)
                        const riskText = describeClearImportedScopeRisk(options)
                        confirmClearDataTwice({
                          scopeLabel,
                          riskText,
                          finalTitle: '最后确认：按条件清空数据',
                          onConfirm: async () => {
                            setClearing(true)
                            try {
                              await clearImportedData(options)
                              message.success(`已清空：${scopeLabel}`)
                              setClearPeriodId('')
                              setClearPeriod(null)
                              setClearSourceType('')
                              setClearProduct('')
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
                        const scopeLabel = describeClearImportedScope({ all: true })
                        const riskText = describeClearImportedScopeRisk({ all: true })
                        confirmClearDataTwice({
                          scopeLabel,
                          riskText,
                          finalTitle: '最后确认：清空全部数据',
                          onConfirm: async () => {
                            setClearing(true)
                            try {
                              await clearAll()
                              message.success('已清空全部已导入数据')
                              setClearPeriodId('')
                              setClearPeriod(null)
                              setClearSourceType('')
                              setClearProduct('')
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
            )}
          </div>
        )}

        {activeTab === 'audit' && can('viewAudit') && <AuditLogPanel />}

        {activeTab === 'bottles' && can('view') && <MessageBottlePanel />}

        {activeTab === 'requirement_sync' && can('manageRequirementSync') && (
          <div className="space-y-6">
            <ApiKeyPanel />
            <RequirementTicketProgressPanel />
          </div>
        )}
      </div>
    </div>
  )
}
