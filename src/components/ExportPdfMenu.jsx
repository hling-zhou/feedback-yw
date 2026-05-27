import { useMemo, useRef, useState } from 'react'
import { Button, Dropdown } from 'antd'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { FilePdfOutlined } from '@ant-design/icons'
import { useInsights } from '../context/InsightsContext.jsx'
import { downloadInsightPdf } from '../lib/report/downloadPdf.jsx'
import { captureChartsForScope, waitForChartsReady } from '../lib/report/captureChartImages.js'
import { compressChartImagesForPdf } from '../lib/report/compressChartImages.js'
import { yieldForHeavyTask } from '../lib/yieldToMain.js'
import { buildWanTouByProducts } from '../lib/wanTouRatio.js'
import { resolveSnapshotRecords } from '../snapshots/recordScope.js'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'

/**
 * @param {import('../hooks/useAppMessage.js').MessageInstance} message
 * @param {string} content
 */
function showExportProgress(message, content) {
  message.open({
    type: 'loading',
    content,
    duration: 0,
    key: 'pdf-export',
  })
}

/**
 * @param {import('../hooks/useAppMessage.js').MessageInstance} message
 */
function hideExportProgress(message) {
  message.destroy('pdf-export')
}

/**
 * @param {import('../domain/enums.js').DataSourceType} [activeSource] 当前 Tab 来源
 * @param {(scope: string) => Promise<void>} [onPrepareExport] 导出前切换 Tab 并等待图表渲染
 * @param {string} [captureRootId] 截图根节点 id
 */
export default function ExportPdfMenu({
  activeSource,
  onPrepareExport,
  captureRootId = 'insight-workbench-root',
}) {
  const message = useAppMessage()
  const {
    feedbacks,
    currentPeriod,
    overviewSnapshot,
    sourceSnapshots,
    orderVolumes,
    snapshotRebuilding,
  } = useInsights()
  const [loading, setLoading] = useState(false)
  const progressThrottleRef = useRef(0)

  const complaintRecords = useMemo(
    () => resolveSnapshotRecords(feedbacks, sourceSnapshots.complaint_ticket),
    [feedbacks, sourceSnapshots.complaint_ticket],
  )

  const runExport = async (scope) => {
    if (
      (scope === 'overview' && !overviewSnapshot) ||
      (scope !== 'overview' && !sourceSnapshots[scope])
    ) {
      message.warning('请先生成洞察快照后再导出 PDF')
      return
    }
    setLoading(true)
    progressThrottleRef.current = 0
    showExportProgress(message, '正在准备导出 PDF…')
    try {
      await yieldForHeavyTask()
      if (onPrepareExport) {
        await onPrepareExport(scope)
      }
      showExportProgress(message, '等待图表渲染…')
      await waitForChartsReady(900)
      await yieldForHeavyTask()

      const root = document.getElementById(captureRootId) || document
      const throttledProgress = (content) => {
        const now = Date.now()
        if (now - progressThrottleRef.current < 700) return
        progressThrottleRef.current = now
        showExportProgress(message, content)
      }

      let chartImages = await captureChartsForScope(scope, root, ({ index, total, title }) => {
        throttledProgress(
          total > 0 ? `正在截取图表（${index + 1}/${total}）· ${title}` : '正在截取图表…',
        )
      })

      showExportProgress(message, '正在优化图表…')
      chartImages = await compressChartImagesForPdf(chartImages)

      showExportProgress(message, '正在生成 PDF 文件…')
      await yieldForHeavyTask()

      const wanTouRows =
        scope === 'overview'
          ? buildWanTouByProducts({
              period: currentPeriod,
              records: complaintRecords,
              orderVolumes,
              productList: sourceSnapshots.complaint_ticket?.aggregates?.products,
            })
          : []

      await downloadInsightPdf({
        scope,
        period: currentPeriod,
        overview: overviewSnapshot,
        sourceSnapshot: scope === 'overview' ? null : sourceSnapshots[scope],
        exportedBy: '本地用户',
        chartImages,
        wanTouRows,
      })
      hideExportProgress(message)
      const chartNote = chartImages.length
        ? `含 ${chartImages.length} 张图表`
        : '未捕获图表，已导出文字摘要'
      message.success(`PDF 已导出（${chartNote}）`, 4)
    } catch (e) {
      hideExportProgress(message)
      console.error(e)
      message.error(e.message || 'PDF 导出失败')
    } finally {
      setLoading(false)
    }
  }

  const items = [
    {
      key: 'overview',
      label: '综合概述报告',
      onClick: () => runExport('overview'),
    },
    ...DATA_SOURCE_TYPES.map((type) => ({
      key: type,
      label: `${DATA_SOURCE_LABELS[type]}报告`,
      onClick: () => runExport(type),
    })),
  ]

  if (activeSource && activeSource !== 'overview') {
    const idx = items.findIndex((i) => i.key === activeSource)
    if (idx > 0) {
      const [cur] = items.splice(idx, 1)
      items.splice(1, 0, { ...cur, label: `当前：${DATA_SOURCE_LABELS[activeSource]}` })
    }
  }

  return (
    <Dropdown menu={{ items }} trigger={['click']} disabled={Boolean(snapshotRebuilding)}>
      <Button loading={loading} icon={<FilePdfOutlined />}>
        导出 PDF
      </Button>
    </Dropdown>
  )
}
