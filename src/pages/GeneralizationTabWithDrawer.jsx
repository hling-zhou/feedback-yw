import GeneralizationTab from './generalization/GeneralizationTab.jsx'
import TicketDrawerHost from '../components/tickets/TicketDrawerHost.jsx'

/**
 * 举一反三 Tab 容器（薄包装）：共享实现收敛到 TicketDrawerHost（2026-11-04 单源化）。
 *
 * 职责只剩"适配 GeneralizationTab 的透传签名"：
 * - 详情抽屉/展开行传 link 对象 → onOpenRecord(link)（Tab 内部原样透传）
 * - 待复核队列签名适配在 GeneralizationTab 内部完成（recordId+来源 → link 对象）
 */
export default function GeneralizationTabWithDrawer() {
  return (
    <TicketDrawerHost missingHint="未找到该记录，可能不在当前数据源或已被删除">
      {(openRecord) => (
        <GeneralizationTab onOpenRecord={(link) => void openRecord(link)} />
      )}
    </TicketDrawerHost>
  )
}
