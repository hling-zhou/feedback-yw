/** 需求工单号说明（表头 hover、表单提示等） */
export const REQUIREMENT_TICKET_FIELD_TIP =
  '可关联多个；关联后排期与状态由「设置 → 需求工单进展同步」维护，列表自动展示。'

/** 举措与进展 · 排期时间列表头 hover 说明 */
export const SCHEDULE_AT_HEADER_HINT =
  '未关联需求工单：显示填写的排期。已关联：由关联需求工单聚合展示。仅在映射状态与列表状态一致的工单中选取；有过去排期时取最逾期（距今天最远），仅未来时取最近，过去与未来并存时取过去。'

/** 举措与进展页 · 标题下方补充说明 */
export const ACTIONS_PAGE_SUBTITLE_HINT = `需求工单号：${REQUIREMENT_TICKET_FIELD_TIP}`
