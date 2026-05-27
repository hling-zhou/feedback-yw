import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select } from 'antd'
import { WORKFLOW_STATUS_LABELS } from '../../lib/planningRecommendationDisplay.js'

/** @typedef {import('../../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../../domain/overviewConclusions.js').RecommendationUserOverride} RecommendationUserOverride */

const STATUS_OPTIONS = Object.entries(WORKFLOW_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}))

/**
 * @param {Object} props
 * @param {OverviewRecommendation | null} props.rec
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(patch: RecommendationUserOverride) => Promise<void>} props.onSave
 * @param {() => Promise<void>} [props.onReset]
 */
export default function PlanningRecommendationEditModal({
  rec,
  open,
  onClose,
  onSave,
  onReset,
}) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !rec) return
    const override = rec.userOverride
    form.setFieldsValue({
      status: override?.status,
      summary: override?.summary ?? rec.summary ?? rec.text,
      detailsText: (override?.details ?? rec.details ?? []).join('\n'),
      owner: override?.owner,
      dueDate: override?.dueDate || '',
      note: override?.note,
    })
  }, [open, rec, form])

  const handleOk = async () => {
    const values = await form.validateFields()
    const details = String(values.detailsText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    setSaving(true)
    try {
      await onSave({
        status: values.status,
        summary: values.summary?.trim(),
        details: details.length ? details : undefined,
        owner: values.owner?.trim() || undefined,
        dueDate: values.dueDate?.trim() || undefined,
        note: values.note?.trim() || undefined,
        updatedAt: new Date().toISOString(),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="编辑行动建议"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={saving}
      width={640}
      destroyOnHidden
      footer={(_, { OkBtn, CancelBtn }) => (
        <>
          {rec?.userOverride && onReset ? (
            <button
              type="button"
              className="mr-auto text-xs text-gray-500 hover:text-indigo-600"
              onClick={async () => {
                await onReset()
                onClose()
              }}
            >
              恢复系统生成
            </button>
          ) : null}
          <CancelBtn />
          <OkBtn />
        </>
      )}
    >
      <Form form={form} layout="vertical" className="mt-2">
        <Form.Item name="status" label="跟进状态">
          <Select allowClear placeholder="待评审（默认）" options={STATUS_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="summary"
          label="概述"
          rules={[{ required: true, message: '请填写概述' }]}
        >
          <Input.TextArea rows={2} maxLength={120} showCount />
        </Form.Item>
        <Form.Item name="detailsText" label="详细意见（每行一条）">
          <Input.TextArea rows={4} placeholder="每行一条详细意见" />
        </Form.Item>
        <Form.Item name="owner" label="负责人">
          <Input placeholder="可选" />
        </Form.Item>
        <Form.Item name="dueDate" label="目标日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input.TextArea rows={2} placeholder="周会备注、依赖项等" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
