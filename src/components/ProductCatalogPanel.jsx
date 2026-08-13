import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import { useAppMessage } from '../hooks/useAppMessage.js'
import {
  DeleteOutlined,
  EditOutlined,
  FileExcelOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useInsights } from '../context/InsightsContext.jsx'
import { getCatalogProducts } from '../lib/productCatalog.js'
import {
  catalogToTableRows,
  downloadProductCatalogExcel,
  downloadProductCatalogJson,
  ensureUniqueProductKey,
  formatMergeCatalogResultMessage,
  MERGE_CATALOG_BY_KEY_HELP,
  normalizeCatalogProducts,
  parseCatalogImportJson,
  slugProductKey,
} from '../lib/productCatalogManageModel.js'
import { canonicalTaxonomyKey } from '../lib/taxonomyKeyAliases.js'
import { parseProductCatalogWorkbook } from '../lib/productCatalogExcel.js'

/**
 * @param {{
 *   catalogMeta?: {
 *     loadedAt: string | null;
 *     source: string;
 *     configFile?: string;
 *     enabledCount?: number;
 *     enabledNames?: string;
 *   } | null;
 *   readOnly?: boolean;
 * }}
 */
export default function ProductCatalogPanel({ catalogMeta, readOnly = false }) {
  const message = useAppMessage()
  const {
    getManagedProductCatalogSnapshot,
    saveManagedProductCatalog,
    importManagedProductCatalog,
    productCatalogReloading,
  } = useInsights()

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [productModal, setProductModal] = useState(false)
  const [specModal, setSpecModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [editingSpec, setEditingSpec] = useState(
    /** @type {{ productKey: string; index: number } | null} */ (null),
  )
  const [productForm] = Form.useForm()
  const [specForm] = Form.useForm()

  const isManaged = catalogMeta?.source === 'managed'
  const tableData = useMemo(() => catalogToTableRows(products), [products])

  const mergeImportTooltip = (
    <div className="max-w-sm whitespace-pre-line text-sm">{MERGE_CATALOG_BY_KEY_HELP}</div>
  )

  const loadLocal = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getManagedProductCatalogSnapshot()
      setProducts(snap.products || getCatalogProducts())
    } finally {
      setLoading(false)
    }
  }, [getManagedProductCatalogSnapshot])

  useEffect(() => {
    loadLocal()
  }, [loadLocal, catalogMeta?.loadedAt])

  const persist = async (next) => {
    if (readOnly) return
    setSaving(true)
    try {
      await saveManagedProductCatalog(next)
      setProducts(next)
      message.success('已保存产品规格配置')
    } catch (e) {
      message.error(e.message || '保存失败')
      throw e
    } finally {
      setSaving(false)
    }
  }

  const openAddProduct = () => {
    setEditingProduct(null)
    productForm.setFieldsValue({
      key: '',
      name: '',
      enabled: true,
      analysisPostUseRating: false,
      focusTracked: false,
      acceptParentName: true,
    })
    setProductModal(true)
  }

  const openEditProduct = (row) => {
    setEditingProduct(row)
    productForm.setFieldsValue({
      key: row.key,
      name: row.name,
      enabled: row.enabled,
      analysisPostUseRating: Boolean(row.analysisPostUseRating),
      focusTracked: Boolean(row.focusTracked),
      acceptParentName: row.acceptParentName,
    })
    setProductModal(true)
  }

  const saveProduct = async () => {
    const v = await productForm.validateFields()
    let key = (v.key || '').trim()
    if (!editingProduct && !key) key = slugProductKey(v.name)
    if (!key) {
      message.warning('请填写产品 Key')
      return
    }
    ensureUniqueProductKey(products, key, editingProduct?.key)
    const nextProduct = {
      key,
      name: v.name.trim(),
      enabled: Boolean(v.enabled),
      analysisPostUseRating: Boolean(v.analysisPostUseRating),
      focusTracked: Boolean(v.focusTracked),
      taxonomyKey: canonicalTaxonomyKey(key),
      acceptParentName: v.acceptParentName !== false,
      specs: editingProduct
        ? products.find((p) => p.key === editingProduct.key)?.specs || []
        : [],
    }
    const next = editingProduct
      ? products.map((p) => (p.key === editingProduct.key ? nextProduct : p))
      : [...products, nextProduct]
    await persist(next)
    setProductModal(false)
  }

  const deleteProduct = async (productKey) => {
    await persist(products.filter((p) => p.key !== productKey))
  }

  const openAddSpec = (productKey) => {
    setEditingSpec({ productKey, index: -1 })
    specForm.setFieldsValue({ name: '', matchText: '' })
    setSpecModal(true)
  }

  const openEditSpec = (productKey, index) => {
    const spec = products.find((p) => p.key === productKey)?.specs?.[index]
    setEditingSpec({ productKey, index })
    specForm.setFieldsValue({
      name: spec?.name || '',
      matchText: (spec?.match || []).join(','),
    })
    setSpecModal(true)
  }

  const saveSpec = async () => {
    if (!editingSpec) return
    const v = await specForm.validateFields()
    const name = v.name.trim()
    if (!name) {
      message.warning('请填写规格名称')
      return
    }
    const match = String(v.matchText || '')
      .split(/[,，;；\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const spec = { name, match: match.length ? match : undefined }

    const next = products.map((p) => {
      if (p.key !== editingSpec.productKey) return p
      const specs = [...(p.specs || [])]
      if (editingSpec.index >= 0) {
        if (specs.some((s, i) => s.name === name && i !== editingSpec.index)) {
          throw new Error(`规格名称已存在：${name}`)
        }
        specs[editingSpec.index] = spec
      } else {
        if (specs.some((s) => s.name === name)) throw new Error(`规格名称已存在：${name}`)
        specs.push(spec)
      }
      return { ...p, specs }
    })
    try {
      await persist(next)
      setSpecModal(false)
    } catch (e) {
      message.error(e.message || '保存失败')
    }
  }

  const deleteSpec = async (productKey, index) => {
    const next = products.map((p) => {
      if (p.key !== productKey) return p
      return { ...p, specs: (p.specs || []).filter((_, i) => i !== index) }
    })
    await persist(next)
  }

  const handleMergeImport = async (incoming) => {
    const result = await importManagedProductCatalog(incoming)
    setProducts(result.products)
    message.success(formatMergeCatalogResultMessage(result))
  }

  const handleImportExcel = async (file) => {
    if (readOnly) return false
    setImporting(true)
    try {
      const buffer = await file.arrayBuffer()
      const incoming = normalizeCatalogProducts(parseProductCatalogWorkbook(buffer).products)
      await handleMergeImport(incoming)
    } catch (e) {
      message.error(e.message || '导入失败')
    } finally {
      setImporting(false)
    }
    return false
  }

  const handleImportJson = async (file) => {
    if (readOnly) return false
    setImporting(true)
    try {
      const text = await file.text()
      const incoming = parseCatalogImportJson(text)
      await handleMergeImport(incoming)
    } catch (e) {
      message.error(e.message || '导入失败')
    } finally {
      setImporting(false)
    }
    return false
  }

  const columns = [
    {
      title: '产品',
      dataIndex: 'name',
      render: (name, row) => (
        <span>
          <Typography.Text strong>{name}</Typography.Text>
          <Typography.Text type="secondary" className="ml-2 text-xs">
            {row.key}
          </Typography.Text>
          {row.enabled ? (
            <Tag color="blue" className="!ml-2">
              工单
            </Tag>
          ) : null}
          {row.analysisPostUseRating ? (
            <Tag color="green" className="!ml-2">
              用后即评
            </Tag>
          ) : null}
          {row.focusTracked ? (
            <Tag color="gold" className="!ml-2">
              重点跟踪
            </Tag>
          ) : null}
          {!row.enabled && !row.analysisPostUseRating ? (
            <Tag className="!ml-2">未启用</Tag>
          ) : null}
        </span>
      ),
    },
    {
      title: '规格数',
      dataIndex: 'specCount',
      width: 72,
    },
    {
      title: '旅程模板',
      dataIndex: 'taxonomyKey',
      width: 100,
      render: (key) => <code className="text-xs">{key}</code>,
    },
    ...(readOnly
      ? []
      : [
          {
            title: '操作',
            width: 200,
            render: (_, row) => (
              <Space size="small">
                <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditProduct(row)}>
                  编辑
                </Button>
                <Button type="link" size="small" onClick={() => openAddSpec(row.key)}>
                  加规格
                </Button>
                <Popconfirm title="删除该产品及全部规格？" onConfirm={() => deleteProduct(row.key)}>
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
        title="在线维护产品规格关系"
        description={
          <span>
            配置保存在服务端共享数据库（auth.db，其他用户约 5 秒自动同步）。保存后会自动生成磁盘 Excel/JSON
            备份。保存产品时会自动创建同名旅程模板；可在上方切换到「旅程模板」查看同步结果。批量维护请使用「导入
            Excel」。
            {readOnly ? '当前为只读浏览。' : null}
            {isManaged ? (
              <> 当前使用<strong>共享库配置</strong>。</>
            ) : (
              <> 当前为内置默认；保存后将写入共享库。</>
            )}
          </span>
        }
      />

      <Space wrap className="mb-4">
        {!readOnly && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddProduct}>
            新增产品
          </Button>
        )}
        <Button icon={<ReloadOutlined />} loading={loading} onClick={loadLocal}>
          刷新
        </Button>
        <Button
          icon={<FileExcelOutlined />}
          disabled={!products.length}
          onClick={() => downloadProductCatalogExcel(products)}
        >
          导出 Excel
        </Button>
        <Button disabled={!products.length} onClick={() => downloadProductCatalogJson(products)}>
          导出 JSON
        </Button>
        {!readOnly && (
          <>
            <Tooltip title={mergeImportTooltip} placement="top">
              <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleImportExcel}>
                <Button icon={<UploadOutlined />} loading={importing}>
                  导入 Excel（按 Key 合并）
                </Button>
              </Upload>
            </Tooltip>
            <Tooltip title={mergeImportTooltip} placement="top">
              <Upload accept=".json" showUploadList={false} beforeUpload={handleImportJson}>
                <Button loading={importing}>导入 JSON（按 Key 合并）</Button>
              </Upload>
            </Tooltip>
          </>
        )}
      </Space>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {catalogMeta && (
          <>
            <Tag
              color={
                catalogMeta.source === 'managed'
                  ? 'purple'
                  : catalogMeta.source === 'excel'
                    ? 'success'
                    : catalogMeta.source === 'json'
                      ? 'blue'
                      : 'default'
              }
            >
              {catalogMeta.source === 'managed'
                ? '本机可编辑'
                : catalogMeta.source === 'excel'
                  ? 'Excel 文件'
                  : catalogMeta.source === 'json'
                    ? 'JSON 文件'
                    : '内置默认'}
            </Tag>
            {catalogMeta.configFile && (
              <Typography.Text type="secondary" className="text-xs">
                {catalogMeta.configFile}
              </Typography.Text>
            )}
            {catalogMeta.loadedAt && (
              <Typography.Text type="secondary" className="text-xs">
                更新于 {catalogMeta.loadedAt.slice(0, 16).replace('T', ' ')}
              </Typography.Text>
            )}
          </>
        )}
      </div>

      {catalogMeta?.enabledNames && (
        <Typography.Paragraph type="secondary" className="!mb-3 !text-xs">
          当前分析范围：{catalogMeta.enabledNames}（共 {catalogMeta.enabledCount} 个产品）
        </Typography.Paragraph>
      )}

      <Table
        size="small"
        loading={loading || saving}
        pagination={false}
        rowKey="key"
        dataSource={tableData}
        columns={columns}
        expandable={{
          expandedRowRender: (row) => (
            <Table
              size="small"
              pagination={false}
              rowKey={(_, i) => `${row.key}-spec-${i}`}
              dataSource={row.specs}
              columns={[
                { title: '规格名称', dataIndex: 'name' },
                {
                  title: '匹配别名',
                  dataIndex: 'match',
                  render: (m) =>
                    m?.length ? (
                      <span className="text-xs">{m.join('、')}</span>
                    ) : (
                      <Typography.Text type="secondary" className="text-xs">
                        —
                      </Typography.Text>
                    ),
                },
                {
                  title: '',
                  width: 120,
                  render: (_, spec, index) =>
                    readOnly ? null : (
                      <Space>
                        <Button
                          type="link"
                          size="small"
                          onClick={() => openEditSpec(row.key, index)}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="删除该规格？"
                          onConfirm={() => deleteSpec(row.key, index)}
                        >
                          <Button type="link" size="small" danger>
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    ),
                },
              ]}
            />
          ),
          rowExpandable: (row) => (row.specs?.length || 0) > 0,
        }}
      />

      {!readOnly && (
        <>
          <Modal
            title={editingProduct ? '编辑产品' : '新增产品'}
            open={productModal}
            onCancel={() => setProductModal(false)}
            onOk={saveProduct}
            confirmLoading={saving}
            destroyOnClose
          >
            <Form form={productForm} layout="vertical" className="mt-4">
              <Form.Item
                name="key"
                label="产品 Key"
                rules={[{ required: !editingProduct, message: '必填' }]}
                extra={editingProduct ? '修改 Key 将视为迁移' : '留空则根据名称自动生成'}
              >
                <Input disabled={Boolean(editingProduct)} placeholder="如 eip" />
              </Form.Item>
              <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '必填' }]}>
                <Input placeholder="如 弹性公网IP" />
              </Form.Item>
              <Form.Item name="enabled" label="投诉/咨询工单分析" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="关闭" />
              </Form.Item>
              <Form.Item name="analysisPostUseRating" label="用后即评分析" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="关闭" />
              </Form.Item>
              <Form.Item name="focusTracked" label="用后即评重点跟踪" valuePropName="checked">
                <Switch checkedChildren="是" unCheckedChildren="否" />
              </Form.Item>
              <Alert
                type="info"
                showIcon
                className="!mb-4"
                title="保存后将自动创建与产品 Key 相同的旅程模板（环节为空，请在「旅程环节标签」中自行添加）"
              />
              <Form.Item name="acceptParentName" label="接受产品名称匹配" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Form>
          </Modal>

          <Modal
            title={editingSpec?.index >= 0 ? '编辑规格' : '新增规格'}
            open={specModal}
            onCancel={() => setSpecModal(false)}
            onOk={saveSpec}
            confirmLoading={saving}
            destroyOnClose
          >
            <Form form={specForm} layout="vertical" className="mt-4">
              <Form.Item name="name" label="规格名称" rules={[{ required: true, message: '必填' }]}>
                <Input placeholder="与工单「产品规格」列一致或可被别名匹配" />
              </Form.Item>
              <Form.Item
                name="matchText"
                label="匹配别名"
                extra="逗号、分号或换行分隔，用于匹配工单列中的不同写法"
              >
                <Input.TextArea rows={3} placeholder="弹性公网 IP-移动IP, 弹性公网ip-移动ip" />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </div>
  )
}
