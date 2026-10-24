import { useState, useEffect, useMemo } from 'react'
import { Modal, Radio, Checkbox, Space, Typography, Alert, message } from 'antd'
import {
  DESENSITIZE_FIELDS,
  createAllDesensitizeOptions,
  getEnabledDesensitizeLabels,
} from '../../lib/ticketAnalysisDesensitize.js'

/**
 * 导出分析结果脱敏选择弹窗。
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {number} props.recordCount
 * @param {number} props.columnCount
 * @param {() => void} [props.onCancel]
 * @param {(options: import('../../lib/ticketAnalysisDesensitize.js').DesensitizeOptions) => void} [props.onConfirm]
 */
export default function ExportDesensitizeModal({
  open,
  recordCount = 0,
  columnCount = 30,
  onCancel,
  onConfirm,
}) {
  const [mode, setMode] = useState('desensitize')
  const [checkedKeys, setCheckedKeys] = useState(
    DESENSITIZE_FIELDS.map((f) => f.key),
  )

  // 打开时重置为默认全选脱敏
  useEffect(() => {
    if (open) {
      setMode('desensitize')
      setCheckedKeys(DESENSITIZE_FIELDS.map((f) => f.key))
    }
  }, [open])

  const options = useMemo(() => {
    if (mode === 'none') return null
    const opts = createAllDesensitizeOptions()
    for (const field of DESENSITIZE_FIELDS) {
      opts[field.key] = checkedKeys.includes(field.key)
    }
    return opts
  }, [mode, checkedKeys])

  const handleConfirm = () => {
    if (mode === 'none') {
      onConfirm?.(createAllDesensitizeOptions())
    } else {
      if (checkedKeys.length === 0) {
        message.warning('请至少选择一个脱敏项，或选择"不脱敏"')
        return
      }
      onConfirm?.(options)
    }
  }

  const enabledLabels = useMemo(() => {
    if (mode === 'none' || !options) return []
    return getEnabledDesensitizeLabels(options)
  }, [mode, options])

  return (
    <Modal
      title="导出分析结果"
      open={open}
      onCancel={onCancel}
      onOk={handleConfirm}
      okText="确认导出"
      cancelText="取消"
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Text type="secondary">
          当前筛选范围内共 {recordCount} 条记录，导出 {columnCount} 列。
        </Typography.Text>

        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <Space direction="vertical">
            <Radio value="none">不脱敏（完整导出）</Radio>
            <Radio value="desensitize">脱敏导出</Radio>
          </Space>
        </Radio.Group>

        {mode === 'desensitize' && (
          <>
            <div style={{ paddingLeft: 24 }}>
              <Checkbox.Group
                value={checkedKeys}
                onChange={(values) => setCheckedKeys(values)}
                style={{ width: '100%' }}
              >
                <Space direction="vertical">
                  {DESENSITIZE_FIELDS.map((field) => (
                    <Checkbox key={field.key} value={field.key}>
                      {field.label}
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
            </div>

            {enabledLabels.length > 0 && (
              <Alert
                type="info"
                showIcon
                message={`脱敏字段：${enabledLabels.join('、')}`}
                description="列级脱敏：字段值替换为 ***；正文级脱敏：在受理内容、处理意见、客户请求内容、需求痛点列中做正则替换。脱敏仅影响导出文件，不影响库内数据。"
              />
            )}
          </>
        )}
      </Space>
    </Modal>
  )
}
