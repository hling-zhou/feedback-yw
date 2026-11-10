/**
 * 分页总数展示共享口径（2026-11-11 需求：所有带分页的列表，分页符栏居左显示总数）。
 *
 * 同源判定纪律：antd 的 showTotal 回调默认渲染在分页符 ul 的第一个 li（居左），
 * 项目内此前已有 6 处内联 `(count) => \`共 ${count} 条\``——第 3 处起必须抽共享谓词，
 * 本文件即该共享真源。新消费方一律 import 本常量，禁止再写内联回调。
 *
 * 边界约定：
 * - pagination={false} 的表格无分页栏，不适用；
 * - hideOnSinglePage: true 的原语义保留（单页时整栏隐藏=无总数，属于调用方有意设计）。
 */

/**
 * 分页 showTotal 共享回调。
 * @param {number} total
 * @returns {string}
 */
export function paginationShowTotal(total) {
  return `共 ${total} 条`
}
