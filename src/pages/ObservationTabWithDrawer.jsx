import ObservationTab from './observation/ObservationTab.jsx'
import ObservationMatchQueue from './observation/ObservationMatchQueue.jsx'
import TicketDrawerHost from '../components/tickets/TicketDrawerHost.jsx'

/**
 * 留观 Tab 容器（薄包装）：共享实现收敛到 TicketDrawerHost（2026-11-04 单源化）。
 *
 * 职责只剩"适配两个消费方的不同签名"：
 * - ObservationTab 详情/展开行传 link 对象 → onOpenRecord(link)
 * - ObservationMatchQueue 直传 (recordId, dataSourceType) → onOpenRecord(recordId, dataSourceType)
 *
 * 历史注释（查找顺序/三级兜底说明）移至 TicketDrawerHost 组件 JSDoc。
 */
export default function ObservationTabWithDrawer() {
  return (
    <TicketDrawerHost missingHint="未找到该记录，可能不在当前数据源或已被删除">
      {(openRecord, openRecordByPair) => (
        <>
          <ObservationTab onOpenRecord={(link) => void openRecord(link)} />
          <ObservationMatchQueue
            onOpenRecord={(recordId, dataSourceType) => void openRecordByPair(recordId, dataSourceType)}
          />
        </>
      )}
    </TicketDrawerHost>
  )
}
