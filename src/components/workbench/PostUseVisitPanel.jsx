import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  message,
} from 'antd'
import { PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { useInsights } from '../../context/InsightsContext.jsx'
import { randomId } from '../../lib/randomId.js'
import {
  loadVisitRecords,
  saveVisitRecords,
  upsertVisitRecord,
  visitMonthForReport,
} from '../../lib/postUseRating/visitRecords.js'
import { getPostUseRatingProductNames } from '../../lib/productCatalog/postUseRatingProducts.js'
import { getCatalogProducts } from '../../lib/productCatalogLoader.js'

const CONCLUSIONS = [
  '无需优改（客户误操作/无实际不满/账户异常/极小概率场景）',
  '综合评估后暂不处理',
  '受限于移动云统一规则无法支持',
  '需求接纳（依赖集团排期）',
  '无需优化（其他产品问题）',
  '待客户反馈',
]

/**
 * @param {{ reportMonth?: string }} props reportMonth=当前洞察月；表单默认 visitMonth=N-1
 */
export default function PostUseVisitPanel({ reportMonth }) {
  const { adapter } = useInsights()
  const [records, setRecords] = useState([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const defaultVisitMonth = useMemo(
    () => (reportMonth ? visitMonthForReport(reportMonth) : ''),
    [reportMonth],
  )
  const productOptions = useMemo(
    () =>
      getPostUseRatingProductNames(getCatalogProducts()).map((n) => ({
        label: n,
        value: n,
      })),
    [],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!adapter) return
      const list = await loadVisitRecords(adapter)
      if (!cancelled) setRecords(list)
    })()
    return () => {
      cancelled = true
    }
  }, [adapter])

  const visible = useMemo(() => {
    if (!defaultVisitMonth) return records
    return records.filter((r) => r.visitMonth === defaultVisitMonth)
  }, [records, defaultVisitMonth])

  const openCreate = () => {
    form.setFieldsValue({
      visitMonth: defaultVisitMonth,
      productName: undefined,
      scoreSource: '控制台评分',
      internalConclusion: CONCLUSIONS[0],
    })
    setOpen(true)
  }

  const onSave = async () => {
    const v = await form.validateFields()
    if (!adapter) return
    setSaving(true)
    try {
      const item = {
        id: randomId(),
        visitMonth: v.visitMonth,
        productName: v.productName,
        feedbackSummary: v.feedbackSummary,
        scoreSource: v.scoreSource,
        ratingText: v.ratingText,
        userInfo: v.userInfo,
        visitResult: v.visitResult,
        internalConclusion: v.internalConclusion,
        jiraId: v.jiraId || '',
        updatedAt: new Date().toISOString(),
      }
      const next = upsertVisitRecord(records, item)
      await saveVisitRecords(adapter, next)
      setRecords(next)
      setOpen(false)
      message.success('已保存回访信息')
    } catch (e) {
      message.error(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      size="small"
      title={`客服回访录入（默认 ${defaultVisitMonth || '—'} 月，供月报 1.2/3.2）`}
      extra={
        <Space size="small">
          <Link to="/import?source=post_use_rating&subType=customer_visit">
            <Button type="primary" size="small" icon={<UploadOutlined />}>
              批量导入回访
            </Button>
          </Link>
          <Button size="small" icon={<PlusOutlined />} onClick={openCreate}>
            单条补录
          </Button>
        </Space>
      }
    >
      <Table
        size="small"
        rowKey="id"
        pagination={{ pageSize: 5 }}
        dataSource={visible}
        columns={[
          { title: '回访月', dataIndex: 'visitMonth', width: 88 },
          { title: '产品', dataIndex: 'productName', width: 120 },
          { title: '摘要', dataIndex: 'feedbackSummary', ellipsis: true },
          { title: '内部结论', dataIndex: 'internalConclusion', width: 160, ellipsis: true },
        ]}
        locale={{ emptyText: '暂无回访记录，可对照 6 月月报 1.2/3.2 录入' }}
      />

      <Modal
        title="录入客服回访"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={onSave}
        confirmLoading={saving}
        destroyOnClose
        width={640}
      >
        <Form form={form} layout="vertical" className="mt-2">
          <Form.Item name="visitMonth" label="回访月份" rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM" />
          </Form.Item>
          <Form.Item name="productName" label="产品" rules={[{ required: true }]}>
            <Select options={productOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="feedbackSummary" label="客户反馈摘要" rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space className="w-full" size="middle">
            <Form.Item name="scoreSource" label="评分来源" rules={[{ required: true }]}>
              <Select
                options={['控制台评分', '短信评分', '投诉回访'].map((x) => ({
                  label: x,
                  value: x,
                }))}
              />
            </Form.Item>
            <Form.Item name="ratingText" label="用后即评评分" rules={[{ required: true }]}>
              <Input placeholder="如 1分*1" />
            </Form.Item>
          </Space>
          <Form.Item name="userInfo" label="用户信息" rules={[{ required: true }]}>
            <Input placeholder="客户名称 + 订单号" />
          </Form.Item>
          <Form.Item name="visitResult" label="回访结果" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="internalConclusion" label="内部结论" rules={[{ required: true }]}>
            <Select options={CONCLUSIONS.map((c) => ({ label: c, value: c }))} />
          </Form.Item>
          <Form.Item name="jiraId" label="关联需求/举措单号（可选）">
            <Input placeholder="映射举措与进展，不新建 JIRA 库" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
