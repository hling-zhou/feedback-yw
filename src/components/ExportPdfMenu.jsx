import { Button, Dropdown, Tooltip } from 'antd'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { FilePdfOutlined } from '@ant-design/icons'
import { useInsights } from '../context/InsightsContext.jsx'
import { usePdfExport } from '../context/PdfExportContext.jsx'
import { useSharedBackgroundTaskBlock } from '../hooks/useSharedBackgroundTaskBlock.js'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'

/**
 * @param {import('../domain/enums.js').DataSourceType} [activeSource] 当前 Tab 来源
 */
export default function ExportPdfMenu({ activeSource }) {
  const message = useAppMessage()
  const { enqueuePdfExport, activeTaskCount } = usePdfExport()
  const { pdfExportBlocked, pdfExportBlockedTip } = useSharedBackgroundTaskBlock()
  const {
    feedbacks,
    currentPeriod,
    overviewSnapshot,
    sourceSnapshots,
    orderVolumes,
    wanTouTargets,
    snapshotRebuilding,
  } = useInsights()

  const exportDisabled = Boolean(snapshotRebuilding) || pdfExportBlocked

  const submitExport = (scope) => {
    if (exportDisabled) {
      message.warning(pdfExportBlockedTip || '当前无法导出 PDF，请稍后再试')
      return
    }
    if (
      (scope === 'overview' && !overviewSnapshot) ||
      (scope !== 'overview' && !sourceSnapshots[scope])
    ) {
      message.warning('请先生成洞察快照后再导出 PDF')
      return
    }

    enqueuePdfExport({
      scope,
      period: currentPeriod,
      overview: overviewSnapshot,
      sourceSnapshots,
      feedbacks,
      orderVolumes,
      wanTouTargets,
    })
  }

  const items = [
    {
      key: 'overview',
      label: '综合概述报告',
      onClick: () => submitExport('overview'),
    },
    ...DATA_SOURCE_TYPES.map((type) => ({
      key: type,
      label: `${DATA_SOURCE_LABELS[type]}报告`,
      onClick: () => submitExport(type),
    })),
  ]

  if (activeSource && activeSource !== 'overview') {
    const idx = items.findIndex((i) => i.key === activeSource)
    if (idx > 0) {
      const [cur] = items.splice(idx, 1)
      items.splice(1, 0, { ...cur, label: `当前：${DATA_SOURCE_LABELS[activeSource]}` })
    }
  }

  const button = (
    <Button icon={<FilePdfOutlined />} disabled={exportDisabled}>
      导出 PDF{activeTaskCount > 0 ? ` (${activeTaskCount})` : ''}
    </Button>
  )

  return (
    <Dropdown menu={{ items }} trigger={['click']} disabled={exportDisabled}>
      {exportDisabled && pdfExportBlockedTip ? (
        <Tooltip title={pdfExportBlockedTip}>{button}</Tooltip>
      ) : (
        button
      )}
    </Dropdown>
  )
}
