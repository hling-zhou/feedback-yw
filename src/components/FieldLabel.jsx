import { Tooltip } from 'antd'

/**
 * 表单字段标签通用组件（2026-11-04 用户拍板：必填项必须有必填标记，全局统一）。
 *
 * 样式对齐 antd Form.Item 默认标签（2026-11-04 02:40 校准——全局样式一致性）：
 * - 字号 text-sm(14px) / 常规字重（antd labelFontSize=fontSize=14、无 font-weight）；
 * - 颜色 ink-800（antd labelColor=colorTextHeading≈rgba(0,0,0,.88) 的深色标题色，非灰）；
 * - 必填 * 红色（antd labelRequiredMarkColor=colorError）——位置对齐 antd（标签后紧跟）；
 * - hint 浅灰小字（text-xs ink-400）与标签明确拉开层级——对齐 Form.Item extra 的辅助位。
 *
 * 通用约束（新增任何表单必须遵守）：
 * - 必填字段 → <FieldLabel required>问题标题</FieldLabel>
 * - 可选字段 → <FieldLabel>关键词</FieldLabel>
 * - 补充说明 → hint 属性；长说明用 tooltip 收纳
 * - antd Form.Item 场景直接用其 required 属性（样式天然同源）；手写标签场景一律用本组件
 *
 * @param {Object} props
 * @param {import('react').ReactNode} props.children - 标签文本
 * @param {boolean} [props.required] - 必填标记（红色 *，对齐 antd colorError）
 * @param {string} [props.hint] - 补充说明（浅灰小字，与标签拉开层级）
 * @param {import('react').ReactNode} [props.tooltip] - 悬浮说明（ⓘ 图标触发）
 */
export default function FieldLabel({ children, required = false, hint, tooltip }) {
  return (
    <span className="mb-1 block text-sm text-ink-800">
      {children}
      {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      {hint ? <span className="ml-1.5 text-xs font-normal text-ink-400">{hint}</span> : null}
      {tooltip ? (
        <Tooltip title={tooltip}>
          <span className="ml-1 cursor-help text-xs text-ink-400">ⓘ</span>
        </Tooltip>
      ) : null}
    </span>
  )
}
