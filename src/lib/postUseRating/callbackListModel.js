import { buildPostUseCallbackRecommendations, buildPostUseCallbackNonTenRecords } from './callbackRecommendations.js'

/**
 * 反馈库 ·「建议回访/溯源清单」tab 的共享清单构建入口（2026-11-21 平铺需求）。
 *
 * 与工作台弹窗（storyModel.callbackRecommendations / callbackNonTenRecords）的数据链同源：
 * 两处都必须继续调用本模块下层的两个 build 函数——弹窗经 buildPostUseStoryModel 间接调，
 * tab 经本函数直调。改动这两个 build 函数的返回形态 = 改契约，必跑本模块对拍测试
 * （callbackListModel.test.js）与 storyModel.test.js。
 *
 * 与弹窗的差异（显式声明）：产品筛选语义 = 先切 records 再 build（弹窗同款），
 * 即产品下拉改变的是进入构建的评价记录范围，不是对清单行做后过滤。
 *
 * @param {{
 *   records: import('../types.js').FeedbackRecord[],
 *   productNames?: string[],
 *   keyCustomers?: string[],
 *   ticketRecords?: import('../types.js').FeedbackRecord[],
 * }} input
 * @returns {{
 *   recommendations: ReturnType<typeof buildPostUseCallbackRecommendations>,
 *   nonTenRecords: ReturnType<typeof buildPostUseCallbackNonTenRecords>,
 * }}
 */
export function buildPostUseCallbackLists({ records, productNames, keyCustomers = [], ticketRecords = [] }) {
  const recommendations = buildPostUseCallbackRecommendations(records, keyCustomers, {
    productNames,
  })
  const nonTenRecords = buildPostUseCallbackNonTenRecords(records, {
    productNames,
    ticketRecords,
  })
  return { recommendations, nonTenRecords }
}
