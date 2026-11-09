/**
 * 建议回访/溯源清单入口共享判定（2026-11-09 双入口需求）。
 *
 * 同源判定纪律：入口出现两处（用后即评头部「分析与报告」标题行 + PostUseStoryView「客户与证据」模块），
 * disabled 判定与禁用文案必须走同一份逻辑，禁止各写一份过滤条件（判定漂移先例：Tag 12 条 / 筛选 0 条）。
 */

/** 禁用态文案（与 2026-11-06 上线的原「客户与证据」入口口径一致） */
export const CALLBACK_ENTRY_DISABLED_REASON =
  '当前范围内暂无命中“官网问卷类建议回访”或“投诉回访非10分”的记录'

/**
 * @param {object} model storyModel（PostUseStoryView 消费的同一份模型）
 * @returns {boolean} 两类清单都为空时禁用
 */
export function isCallbackEntryDisabled(model) {
  const recommendations = model?.callbackRecommendations || []
  const nonTenRecords = model?.callbackNonTenRecords || []
  return !recommendations.length && !nonTenRecords.length
}
