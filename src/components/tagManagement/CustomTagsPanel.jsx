import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import {
  DeleteOutlined,
  EditOutlined,
  FileExcelOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useInsights } from '../../context/InsightsContext.jsx'
import {
  countManagedProductJourneyL2,
  listJourneyTemplates,
  resolveJourneysForManagedProduct,
} from '../../lib/taxonomyLoader.js'
import { markJourneyConfigured } from '../../lib/productCenterSync.js'
import {
  downloadManagedTaxonomyExcel,
  formatMergeImportResultMessage,
  keywordsToText,
  MERGE_IMPORT_BY_KEY_HELP,
  textToKeywords,
} from '../../lib/tagLibrary/taxonomyManageModel.js'

/**
 * @param {import('../../lib/tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @param {'request_scene' | 'problem_type' | 'journey'} kind
 * @param {string} [productKey]
 */
function filterRows(snapshot, kind, productKey) {
  if (kind === 'request_scene') {
    return (snapshot.sharedRequestScenes || []).map((rs, idx) => ({
      key: `rs-${idx}`,
      label: rs.label,
      keywordsText: keywordsToText(rs.keywords),
      _index: idx,
    }))
  }
  if (kind === 'problem_type') {
    return (snapshot.sharedProblemTypes || []).map((pt, idx) => ({
      key: `pt-${idx}`,
      label: pt.label,
      keywordsText: keywordsToText(pt.keywords),
      _index: idx,
    }))
  }
  const journeys = resolveJourneysForManagedProduct(snapshot.products?.[productKey], productKey)
  if (!journeys.length) return []
  const rows = []
  for (const l1 of journeys) {
    for (const l2 of l1.children || []) {
      rows.push({
        key: `${productKey}::${l1.label}::${l2.label}`,
        l1Name: l1.label,
        l1Desc: l1.description || '',
        l2Name: l2.label,
        l2Desc: l2.description || '',
        keywordsText: keywordsToText(l2.keywords),
        l1Id: l1.id,
        l2Id: l2.id,
      })
    }
  }
  return rows
}

const KIND_META = {
  request_scene: {
    title: '请求场景（全产品通用）',
    description:
      '从用户角度描述发起反馈时的意图与场景（报障、方案咨询、开通权限等）。支持关键词 + 解释 + LLM 混合打标。',
    addLabel: '请求场景',
  },
  problem_type: {
    title: '问题类型（全产品通用）',
    description:
      '从请求本身角度归类（可用性、性能与质量、功能需求与规划等）。支持关键词 + 解释 + LLM 混合打标。',
    addLabel: '问题类型',
  },
  journey: {
    title: '用户旅程（分产品）',
    description:
      '按产品模板维护一级 / 二级旅程环节与说明、关键词。旅程模板在产品配置中随产品自动创建，环节在此维护。',
    addLabel: '旅程环节',
  },
}

/**
 * @param {Object} props
 * @param {'request_scene' | 'problem_type' | 'journey'} props.tagKind
 * @param {boolean} [props.readOnly]
 */
export default function CustomTagsPanel({ tagKind, readOnly = false }) {
  const message = useAppMessage()
  const [searchParams] = useSearchParams()
  const journeyProductFromUrl = searchParams.get('journeyProduct')
  const meta = KIND_META[tagKind]

  const {
    getManagedTaxonomySnapshot,
    saveManagedTaxonomy,
    repairBuiltinTaxonomyJourneys,
    importManagedTaxonomyIncremental,
    taxonomyReloading,
    taxonomyMeta,
  } = useInsights()

  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [productKey, setProductKey] = useState('eip')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const [repairing, setRepairing] = useState(false)

  const templates = useMemo(() => listJourneyTemplates(), [snapshot, taxonomyMeta])

  const journeyL2Count = useMemo(
    () => (snapshot ? countManagedProductJourneyL2(snapshot, productKey) : 0),
    [snapshot, productKey],
  )

  const loadSnapshot = useCallback(async () => {
    setLoading(true)
    try {
      const s = await getManagedTaxonomySnapshot()
      setSnapshot(s)
      if (s?.products && !s.products[productKey]) {
        const first = Object.keys(s.products).find((k) => k === 'vpc') || Object.keys(s.products)[0]
        if (first) setProductKey(first)
      }
    } finally {
      setLoading(false)
    }
  }, [getManagedTaxonomySnapshot, productKey])

  const handleRepairBuiltinJourneys = async () => {
    if (readOnly) return
    setRepairing(true)
    try {
      await repairBuiltinTaxonomyJourneys()
      await loadSnapshot()
      message.success('已写入虚拟私有云等内置用户旅程，请在下拉框中选择对应产品查看')
    } catch (e) {
      message.error(e.message || '修复失败')
    } finally {
      setRepairing(false)
    }
  }

  useEffect(() => {
    loadSnapshot()
  }, [loadSnapshot])

  useEffect(() => {
    if (
      tagKind === 'journey' &&
      journeyProductFromUrl &&
      snapshot?.products?.[journeyProductFromUrl]
    ) {
      setProductKey(journeyProductFromUrl)
    }
  }, [tagKind, journeyProductFromUrl, snapshot])

  const persist = async (next) => {
    if (readOnly) return
    setSaving(true)
    try {
      if (tagKind === 'journey' && productKey) {
        markJourneyConfigured(next, productKey)
      }
      await saveManagedTaxonomy(next)
      setSnapshot(next)
      message.success('已保存标签库')
    } catch (e) {
      message.error(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const requestSceneRows = useMemo(
    () => (snapshot ? filterRows(snapshot, 'request_scene') : []),
    [snapshot],
  )

  const problemRows = useMemo(
    () => (snapshot ? filterRows(snapshot, 'problem_type') : []),
    [snapshot],
  )

  const journeyRows = useMemo(
    () => (snapshot ? filterRows(snapshot, 'journey', productKey) : []),
    [snapshot, productKey],
  )

  const openAdd = () => {
    setEditing(null)
    form.resetFields()
    if (tagKind === 'journey') {
      form.setFieldsValue({ productKey })
    }
    setModalOpen(true)
  }

  const openEdit = (row) => {
    setEditing(row)
    if (tagKind === 'request_scene' || tagKind === 'problem_type') {
      form.setFieldsValue({
        label: row.label,
        keywordsText: row.keywordsText,
      })
    } else {
      form.setFieldsValue({
        l1Name: row.l1Name,
        l1Desc: row.l1Desc,
        l2Name: row.l2Name,
        l2Desc: row.l2Desc,
        keywordsText: row.keywordsText,
      })
    }
    setModalOpen(true)
  }

  const handleDeleteRequestScene = async (row) => {
    if (!snapshot) return
    const next = JSON.parse(JSON.stringify(snapshot))
    next.sharedRequestScenes = (next.sharedRequestScenes || []).filter((_, i) => i !== row._index)
    await persist(next)
  }

  const handleDeleteProblem = async (row) => {
    if (!snapshot) return
    const next = JSON.parse(JSON.stringify(snapshot))
    next.sharedProblemTypes = next.sharedProblemTypes.filter((_, i) => i !== row._index)
    await persist(next)
  }

  const handleDeleteJourney = async (row) => {
    if (!snapshot) return
    const next = JSON.parse(JSON.stringify(snapshot))
    const tax = next.products[productKey]
    if (!tax) return
    for (const l1 of tax.journeys) {
      l1.children = (l1.children || []).filter((c) => c.label !== row.l2Name)
    }
    tax.journeys = tax.journeys.filter((l1) => (l1.children || []).length > 0)
    await persist(next)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    if (!snapshot) return
    const next = JSON.parse(JSON.stringify(snapshot))

    if (tagKind === 'request_scene') {
      const label = values.label?.trim()
      if (!label) {
        message.error('请求场景名称不能为空')
        return
      }
      if (!next.sharedRequestScenes) next.sharedRequestScenes = []
      const item = {
        label,
        keywords: textToKeywords(values.keywordsText),
      }
      if (editing != null && editing._index != null) {
        next.sharedRequestScenes[editing._index] = item
      } else {
        if (next.sharedRequestScenes.some((t) => t.label === label)) {
          message.warning('该请求场景已存在')
          return
        }
        next.sharedRequestScenes.push(item)
      }
    } else if (tagKind === 'problem_type') {
      const label = values.label?.trim()
      if (!label) {
        message.error('问题类型名称不能为空')
        return
      }
      const item = {
        label,
        keywords: textToKeywords(values.keywordsText),
      }
      if (editing != null && editing._index != null) {
        next.sharedProblemTypes[editing._index] = item
      } else {
        if (next.sharedProblemTypes.some((t) => t.label === label)) {
          message.warning('该问题类型已存在')
          return
        }
        next.sharedProblemTypes.push(item)
      }
    } else {
      const l1Name = values.l1Name?.trim()
      const l2Name = values.l2Name?.trim()
      if (!l1Name || !l2Name) {
        message.error('一级、二级名称不能为空')
        return
      }
      if (!next.products[productKey]) {
        next.products[productKey] = {
          key: productKey,
          name: templates.find((t) => t.key === productKey)?.name || productKey,
          match: [],
          journeys: [],
          catalogProvisioned: true,
          journeyConfigured: false,
        }
      }
      const tax = next.products[productKey]
      let l1 = tax.journeys.find((j) => j.label === l1Name)
      if (!l1) {
        l1 = {
          id: l1Name,
          label: l1Name,
          description: values.l1Desc?.trim() || '',
          children: [],
        }
        tax.journeys.push(l1)
      } else if (values.l1Desc?.trim()) {
        l1.description = values.l1Desc.trim()
      }
      const l2Item = {
        id: values.l2Id?.trim() || l2Name,
        label: l2Name,
        description: values.l2Desc?.trim() || '',
        keywords: textToKeywords(values.keywordsText),
      }
      const existIdx = (l1.children || []).findIndex((c) => c.label === l2Name)
      if (editing && existIdx >= 0) {
        l1.children[existIdx] = l2Item
      } else if (existIdx >= 0) {
        message.warning('该二级环节已存在')
        return
      } else {
        l1.children.push(l2Item)
      }
    }

    await persist(next)
    setModalOpen(false)
  }

  const formatImportResultMessage = (result) => formatMergeImportResultMessage(result)

  const mergeImportTooltip = (
    <div className="max-w-sm whitespace-pre-line text-sm">{MERGE_IMPORT_BY_KEY_HELP}</div>
  )

  const handleImport = async (file) => {
    if (readOnly) return false
    setImporting(true)
    try {
      const buffer = await file.arrayBuffer()
      const result = await importManagedTaxonomyIncremental(buffer)
      if (!result.ok) {
        Modal.error({
          title: '导入校验未通过',
          content: (
            <ul className="mb-0 max-h-60 list-disc overflow-auto pl-5">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ),
        })
        return false
      }
      await loadSnapshot()
      message.success(formatImportResultMessage(result))
    } catch (e) {
      message.error(e.message || '导入失败')
    } finally {
      setImporting(false)
    }
    return false
  }

  const sharedTagColumns = (deleteHandler, nameTitle) => {
    const cols = [
      { title: nameTitle, dataIndex: 'label', width: 180 },
      { title: '参考关键词', dataIndex: 'keywordsText', ellipsis: true },
    ]
    if (!readOnly) {
      cols.push({
        title: '操作',
        width: 120,
        render: (_, row) => (
          <Space>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
            <Popconfirm title="确定删除？" onConfirm={() => deleteHandler(row)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ),
      })
    }
    return cols
  }

  const requestSceneColumns = sharedTagColumns(handleDeleteRequestScene, '请求场景')
  const problemColumns = sharedTagColumns(handleDeleteProblem, '问题类型')

  const journeyColumns = [
    { title: '一级环节', dataIndex: 'l1Name', width: 120 },
    { title: '二级环节', dataIndex: 'l2Name', width: 120 },
    { title: '一级说明', dataIndex: 'l1Desc', ellipsis: true },
    { title: '二级说明', dataIndex: 'l2Desc', ellipsis: true },
    { title: '参考关键词', dataIndex: 'keywordsText', ellipsis: true },
    ...(readOnly
      ? []
      : [
          {
            title: '操作',
            width: 120,
            render: (_, row) => (
              <Space>
                <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
                <Popconfirm title="确定删除？" onConfirm={() => handleDeleteJourney(row)}>
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]),
  ]

  return (
    <div>
      <Alert
        type="info"
        showIcon
        className="!mb-4"
        title={meta.title}
        description={`${meta.description} 保存后写入共享库（auth.db，其他用户约 5 秒内自动同步）。生产环境将自动生成 Excel/JSON 磁盘备份；批量维护请使用「导入 Excel」。`}
      />

      <Space wrap className="mb-4">
        {!readOnly && (
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
              新增标签
            </Button>
            <Tooltip title={mergeImportTooltip} placement="top">
              <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleImport}>
                <Button icon={<UploadOutlined />} loading={importing}>
                  导入 Excel（按 Key 合并）
                </Button>
              </Upload>
            </Tooltip>
          </>
        )}
        <Button
          icon={<FileExcelOutlined />}
          disabled={!snapshot}
          onClick={() => snapshot && downloadManagedTaxonomyExcel(snapshot)}
        >
          导出 Excel
        </Button>
        {taxonomyMeta?.configFile && (
          <Typography.Text type="secondary" className="text-xs">
            来源：{taxonomyMeta.configFile}
          </Typography.Text>
        )}
      </Space>

      {tagKind === 'request_scene' && (
        <Table
          rowKey="key"
          size="small"
          loading={loading || saving}
          dataSource={requestSceneRows}
          columns={requestSceneColumns}
          pagination={{ pageSize: 15 }}
        />
      )}
      {tagKind === 'problem_type' && (
        <Table
          rowKey="key"
          size="small"
          loading={loading || saving}
          dataSource={problemRows}
          columns={problemColumns}
          pagination={{ pageSize: 15 }}
        />
      )}
      {tagKind === 'journey' && (
        <>
          {journeyL2Count === 0 && productKey === 'vpc' && (
            <Alert
              type="warning"
              showIcon
              className="!mb-3"
              title="虚拟私有云旅程尚未写入共享库"
              description="共享库中该产品模板可能仍为空。点击下方「修复内置旅程」将 7 个一级、24 个二级环节写入团队标签库（需标签管理权限）。"
              action={
                !readOnly ? (
                  <Button size="small" loading={repairing} onClick={handleRepairBuiltinJourneys}>
                    修复内置旅程
                  </Button>
                ) : null
              }
            />
          )}
          <Space wrap className="mb-3">
            <Select
              className="min-w-[220px]"
              value={productKey}
              options={templates.map((t) => ({
                label: `${t.name}（${t.key}）· ${countManagedProductJourneyL2(snapshot, t.key)} 个二级环节`,
                value: t.key,
              }))}
              onChange={setProductKey}
            />
            {!readOnly && (
              <Button loading={repairing} onClick={handleRepairBuiltinJourneys}>
                修复内置旅程
              </Button>
            )}
          </Space>
          <Table
            rowKey="key"
            size="small"
            loading={loading || saving}
            dataSource={journeyRows}
            columns={journeyColumns}
            pagination={{ pageSize: 15 }}
          />
        </>
      )}

      {!readOnly && (
        <Modal
          title={editing ? '编辑标签' : '新增标签'}
          open={modalOpen}
          onCancel={() => setModalOpen(false)}
          onOk={handleSubmit}
          confirmLoading={saving}
          destroyOnClose
        >
          <Form form={form} layout="vertical" className="mt-2">
            {tagKind === 'request_scene' || tagKind === 'problem_type' ? (
              <>
                <Form.Item
                  name="label"
                  label={tagKind === 'request_scene' ? '请求场景名称' : '问题类型名称'}
                  rules={[{ required: true, message: '不能为空' }]}
                >
                  <Input
                    placeholder={
                      tagKind === 'request_scene' ? '如：报障与恢复' : '如：性能与质量'
                    }
                    disabled={editing != null}
                  />
                </Form.Item>
                <Form.Item name="keywordsText" label="参考关键词（逗号分隔）">
                  <Input.TextArea rows={2} />
                </Form.Item>
              </>
            ) : (
              <>
                <Form.Item
                  name="l1Name"
                  label="一级环节名称"
                  rules={[{ required: true, message: '不能为空' }]}
                >
                  <Input disabled={editing != null} />
                </Form.Item>
                <Form.Item name="l1Desc" label="一级说明">
                  <Input />
                </Form.Item>
                <Form.Item
                  name="l2Name"
                  label="二级环节名称"
                  rules={[{ required: true, message: '不能为空' }]}
                >
                  <Input disabled={editing != null} />
                </Form.Item>
                <Form.Item name="l2Desc" label="二级说明">
                  <Input />
                </Form.Item>
                <Form.Item name="keywordsText" label="参考关键词">
                  <Input.TextArea rows={2} />
                </Form.Item>
              </>
            )}
          </Form>
        </Modal>
      )}
    </div>
  )
}
