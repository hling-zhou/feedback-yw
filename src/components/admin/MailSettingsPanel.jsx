import { useEffect, useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Typography, message } from 'antd'
import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../../domain/enums.js'
import {
  createMailChannel,
  createMailGroup,
  createMailTemplate,
  deleteMailChannel,
  deleteMailGroup,
  deleteMailTemplate,
  loadMailStatus,
  saveMailPublicUrl,
  updateMailChannel,
  updateMailGroup,
  updateMailTemplate,
} from '../../lib/mailClient.js'

const SOURCE_OPTIONS = DATA_SOURCE_TYPES.map((value) => ({
  value,
  label: DATA_SOURCE_LABELS[value],
}))

export default function MailSettingsPanel({ canEdit = false }) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ publicAppUrl: '', channels: [], groups: [], templates: [] })
  const [publicAppUrl, setPublicAppUrl] = useState('')
  const [channelOpen, setChannelOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState(null)
  const [editingGroup, setEditingGroup] = useState(null)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [channelForm] = Form.useForm()
  const [groupForm] = Form.useForm()
  const [templateForm] = Form.useForm()

  const reload = async () => {
    setLoading(true)
    try {
      const data = await loadMailStatus()
      setStatus(data)
      setPublicAppUrl(data.publicAppUrl || '')
    } catch (error) {
      message.error(error?.message || '加载邮件设置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const saveUrl = async () => {
    try {
      const saved = await saveMailPublicUrl(publicAppUrl)
      setPublicAppUrl(saved.publicAppUrl || '')
      message.success('已保存平台访问地址')
    } catch (error) {
      message.error(error?.message || '保存失败')
    }
  }

  const openChannel = (item) => {
    setEditingChannel(item)
    channelForm.setFieldsValue(
      item
        ? { ...item, password: '', secure: item.secure !== false }
        : { port: 465, secure: true, dataSourceType: 'post_use_rating' },
    )
    setChannelOpen(true)
  }

  const saveChannel = async () => {
    const values = await channelForm.validateFields()
    try {
      if (editingChannel) await updateMailChannel(editingChannel.id, values)
      else await createMailChannel(values)
      message.success('已保存发信通道')
      setChannelOpen(false)
      await reload()
    } catch (error) {
      message.error(error?.message || '保存失败')
    }
  }

  const openGroup = (item) => {
    setEditingGroup(item)
    groupForm.setFieldsValue({
      name: item?.name || '',
      emails: (item?.emails || []).join('\n'),
    })
    setGroupOpen(true)
  }

  const saveGroup = async () => {
    const values = await groupForm.validateFields()
    const body = {
      name: values.name,
      emails: String(values.emails || '')
        .split(/[\n,;，；]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    }
    try {
      if (editingGroup) await updateMailGroup(editingGroup.id, body)
      else await createMailGroup(body)
      message.success('已保存收件人群组')
      setGroupOpen(false)
      await reload()
    } catch (error) {
      message.error(error?.message || '保存失败')
    }
  }

  const openTemplate = (item) => {
    setEditingTemplate(item)
    templateForm.setFieldsValue({
      name: item?.name || '',
      subject: item?.subject || '',
      body: item?.body || '',
    })
    setTemplateOpen(true)
  }

  const saveTemplate = async () => {
    const values = await templateForm.validateFields()
    try {
      if (editingTemplate) await updateMailTemplate(editingTemplate.id, values)
      else await createMailTemplate(values)
      message.success('已保存邮件模板')
      setTemplateOpen(false)
      await reload()
    } catch (error) {
      message.error(error?.message || '保存失败')
    }
  }

  return (
    <div className="space-y-6">
      <div className="page-card">
        <div className="page-card-header"><span className="page-card-title">平台访问地址</span></div>
        <Typography.Paragraph type="secondary" className="text-xs">
          邮件第三行链接的根地址，例如 https://insights.example.com，不要末尾斜杠。
        </Typography.Paragraph>
        <Space.Compact className="w-full max-w-xl">
          <Input
            disabled={!canEdit}
            value={publicAppUrl}
            onChange={(event) => setPublicAppUrl(event.target.value)}
            placeholder="https://example.com"
          />
          {canEdit ? <Button type="primary" onClick={() => void saveUrl()}>保存</Button> : null}
        </Space.Compact>
      </div>

      <div className="page-card">
        <div className="page-card-header">
          <span className="page-card-title">发信通道</span>
          {canEdit ? <Button size="small" onClick={() => openChannel(null)}>新建</Button> : null}
        </div>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          pagination={false}
          dataSource={status.channels}
          columns={[
            { title: '名称', dataIndex: 'name' },
            { title: '数据来源', dataIndex: 'dataSourceType', render: (value) => DATA_SOURCE_LABELS[value] || value },
            { title: '发件人', dataIndex: 'fromAddress' },
            { title: '主机', dataIndex: 'host' },
            ...(canEdit
              ? [{
                  title: '',
                  width: 140,
                  render: (_, item) => (
                    <Space>
                      <Button size="small" onClick={() => openChannel(item)}>编辑</Button>
                      <Button
                        size="small"
                        danger
                        onClick={() => {
                          Modal.confirm({
                            title: '删除该发信通道？',
                            onOk: async () => {
                              await deleteMailChannel(item.id)
                              await reload()
                            },
                          })
                        }}
                      >
                        删除
                      </Button>
                    </Space>
                  ),
                }]
              : []),
          ]}
        />
      </div>

      <div className="page-card">
        <div className="page-card-header">
          <span className="page-card-title">收件人群组</span>
          {canEdit ? <Button size="small" onClick={() => openGroup(null)}>新建</Button> : null}
        </div>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          pagination={false}
          dataSource={status.groups}
          columns={[
            { title: '名称', dataIndex: 'name' },
            { title: '成员', dataIndex: 'emails', render: (value) => (value || []).join('、') || '—' },
            ...(canEdit
              ? [{
                  title: '',
                  width: 140,
                  render: (_, item) => (
                    <Space>
                      <Button size="small" onClick={() => openGroup(item)}>编辑</Button>
                      <Button
                        size="small"
                        danger
                        onClick={() => {
                          Modal.confirm({
                            title: '删除该群组？',
                            onOk: async () => {
                              await deleteMailGroup(item.id)
                              await reload()
                            },
                          })
                        }}
                      >
                        删除
                      </Button>
                    </Space>
                  ),
                }]
              : []),
          ]}
        />
      </div>

      <div className="page-card">
        <div className="page-card-header">
          <span className="page-card-title">邮件模板</span>
          {canEdit ? <Button size="small" onClick={() => openTemplate(null)}>新建</Button> : null}
        </div>
        <Typography.Paragraph type="secondary" className="text-xs">
          占位符：{'{周期标签}'} {'{周期键}'} {'{月报|季报}'} {'{绝对链接}'}。预置模板可改不可删。
        </Typography.Paragraph>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          pagination={false}
          dataSource={status.templates}
          columns={[
            { title: '名称', dataIndex: 'name' },
            { title: '预置', dataIndex: 'preset', width: 70, render: (value) => (value ? '是' : '') },
            { title: '主题', dataIndex: 'subject', ellipsis: true },
            ...(canEdit
              ? [{
                  title: '',
                  width: 140,
                  render: (_, item) => (
                    <Space>
                      <Button size="small" onClick={() => openTemplate(item)}>编辑</Button>
                      <Button
                        size="small"
                        danger
                        disabled={item.preset}
                        onClick={() => {
                          Modal.confirm({
                            title: '删除该模板？',
                            onOk: async () => {
                              await deleteMailTemplate(item.id)
                              await reload()
                            },
                          })
                        }}
                      >
                        删除
                      </Button>
                    </Space>
                  ),
                }]
              : []),
          ]}
        />
      </div>

      <Modal
        title={editingChannel ? '编辑发信通道' : '新建发信通道'}
        open={channelOpen}
        onCancel={() => setChannelOpen(false)}
        onOk={() => void saveChannel()}
        destroyOnClose
      >
        <Form form={channelForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="dataSourceType" label="数据来源" rules={[{ required: true }]}>
            <Select options={SOURCE_OPTIONS} />
          </Form.Item>
          <Form.Item name="host" label="SMTP 主机" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="port" label="端口"><InputNumber min={1} max={65535} className="w-full" /></Form.Item>
          <Form.Item name="secure" label="SSL/TLS" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="username" label="账号"><Input /></Form.Item>
          <Form.Item name="password" label="密码">
            <Input.Password placeholder={editingChannel?.hasPassword ? '留空则保持原密码' : ''} />
          </Form.Item>
          <Form.Item name="fromAddress" label="发件人" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingGroup ? '编辑收件人群组' : '新建收件人群组'}
        open={groupOpen}
        onCancel={() => setGroupOpen(false)}
        onOk={() => void saveGroup()}
        destroyOnClose
      >
        <Form form={groupForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="emails" label="成员邮箱">
            <Input.TextArea rows={6} placeholder="一行一个，或用逗号分隔" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingTemplate ? '编辑邮件模板' : '新建邮件模板'}
        open={templateOpen}
        onCancel={() => setTemplateOpen(false)}
        onOk={() => void saveTemplate()}
        width={640}
        destroyOnClose
      >
        <Form form={templateForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="subject" label="主题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="body" label="正文" rules={[{ required: true }]}>
            <Input.TextArea rows={8} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
