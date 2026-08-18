import { Collapse, DatePicker, Form, Input, Typography } from 'antd'
import dayjs from 'dayjs'
import ActionItemSelect from '../ActionItemSelect.jsx'
import {
  ESTABLISHED_ACTION_DETAIL_MAX_LENGTH,
  ESTABLISHED_ACTION_MAX_LENGTH,
} from '../../domain/establishedAction.js'
import { normalizeActionSchedule } from '../../domain/actionSchedule.js'
import { getActionItemDisplayScheduleAt } from '../../domain/requirementTicketProgress.js'

/** @typedef {import('../../domain/actionItem.js').ActionItem} ActionItem */

/**
 * @param {Object} props
 * @param {string} [props.productKey]
 * @param {string} [props.actionId]
 * @param {string} [props.establishedAction]
 * @param {string} [props.establishedActionDetail]
 * @param {string} [props.actionSchedule]
 * @param {boolean} [props.linkedFromLibrary]
 * @param {boolean} [props.disabled]
 * @param {(item: ActionItem) => void} [props.onSelect]
 * @param {() => void} [props.onClear]
 * @param {(value: string) => void} [props.onContentChange]
 * @param {(value: string) => void} [props.onDetailChange]
 * @param {(value: string) => void} [props.onScheduleChange]
 */
export default function EstablishedActionFields({
  productKey,
  actionId,
  establishedAction,
  establishedActionDetail,
  actionSchedule,
  linkedFromLibrary = false,
  disabled = false,
  onSelect,
  onClear,
  onContentChange,
  onDetailChange,
  onScheduleChange,
}) {
  const libraryLinked = linkedFromLibrary && Boolean(actionId?.trim())
  const fieldsDisabled = disabled || libraryLinked
  const normalized = normalizeActionSchedule(actionSchedule)
  const parsed = normalized ? dayjs(normalized, 'YYYY-MM-DD', true) : null
  const schedulePickerValue = parsed?.isValid() ? parsed : null

  return (
    <Form layout="vertical">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Typography.Text className="shrink-0 text-sm after:content-[':']">
          从举措库选择
        </Typography.Text>
        <div className="min-w-0 flex-1">
          <ActionItemSelect
            value={actionId || undefined}
            productKey={productKey}
            disabled={disabled}
            onSelect={(item) => {
              onSelect?.(item)
            }}
            onClear={() => {
              onClear?.()
            }}
          />
        </div>
      </div>
      <Form.Item
        label={
          <span className="inline-flex flex-wrap items-center gap-1">
            举措内容
            <Typography.Text type="secondary" className="text-xs font-normal">
              （举措库暂无相匹配的举措时，可直接输入）
            </Typography.Text>
          </span>
        }
        className="!mb-3"
      >
        <Input.TextArea
          rows={3}
          placeholder="默认为空"
          maxLength={ESTABLISHED_ACTION_MAX_LENGTH}
          showCount
          disabled={fieldsDisabled}
          value={establishedAction}
          onChange={(event) => {
            onContentChange?.(event.target.value.slice(0, ESTABLISHED_ACTION_MAX_LENGTH))
          }}
        />
      </Form.Item>
      <Collapse
        ghost
        className="!mb-3 [&_.ant-collapse-header]:!px-0 [&_.ant-collapse-content-box]:!px-0"
        items={[
          {
            key: 'detail',
            label: '举措详情（可选）',
            children: (
              <Input.TextArea
                rows={3}
                placeholder="默认为空"
                maxLength={ESTABLISHED_ACTION_DETAIL_MAX_LENGTH}
                showCount
                disabled={fieldsDisabled}
                value={establishedActionDetail}
                onChange={(event) => {
                  onDetailChange?.(
                    event.target.value.slice(0, ESTABLISHED_ACTION_DETAIL_MAX_LENGTH),
                  )
                }}
              />
            ),
          },
        ]}
      />
      <Form.Item label="排期" className="!mb-0">
        <DatePicker
          className="w-full"
          format="YYYY-MM-DD"
          placeholder="留空 = 待评估"
          value={schedulePickerValue}
          disabled={fieldsDisabled}
          allowClear={!libraryLinked && !disabled}
          onChange={(date) => onScheduleChange?.(date ? date.format('YYYY-MM-DD') : '')}
        />
      </Form.Item>
    </Form>
  )
}

export { getActionItemDisplayScheduleAt }
