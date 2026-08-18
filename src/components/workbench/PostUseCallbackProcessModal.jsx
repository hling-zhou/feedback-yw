import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Modal, Space, Table, Tabs, Tooltip, Typography, message } from 'antd'
import { DownloadOutlined, FolderAddOutlined } from '@ant-design/icons'
import { downloadPostUseCallbackRecommendationsExcel } from '../../lib/postUseRating/callbackRecommendationsExport.js'
import {
  collectFollowupExportRows,
  downloadFollowupTableExcel,
  toJiraArchivePayload,
} from '../../lib/postUseRating/callbackFollowupTables.js'
import {
  archivePostUseJiraItems,
  listPostUseCallbackDecisions,
  upsertPostUseCallbackDecisions,
} from '../../lib/postUseJiraClient.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { canUsePostUseCallbackList } from '../../domain/auth/permissions.js'

function decisionOf(map, itemKey) {
  return map.get(itemKey) || { needCustomerVisit: false, needInternalTrace: false }
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {object[]} props.recommendations
 * @param {object[]} props.callbackNonTenRecords
 * @param {string} [props.scopeLabel]
 */
export default function PostUseCallbackProcessModal({
  open,
  onClose,
  recommendations = [],
  callbackNonTenRecords = [],
  scopeLabel = '当前范围',
}) {
  const { user } = useAuth()
  const canEdit = canUsePostUseCallbackList(user?.role)
  const [decisions, setDecisions] = useState(() => new Map())
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState('')
  const [archiving, setArchiving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    listPostUseCallbackDecisions()
      .then((res) => {
        if (cancelled) return
        const next = new Map()
        for (const item of res?.items || []) {
          if (!item?.itemKey) continue
          next.set(item.itemKey, {
            needCustomerVisit: Boolean(item.needCustomerVisit),
            needInternalTrace: Boolean(item.needInternalTrace),
            sourceType: item.sourceType,
          })
        }
        setDecisions(next)
      })
      .catch((error) => {
        if (!cancelled) message.error(error?.message || '加载勾选状态失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const currentKeys = useMemo(
    () => [
      ...(recommendations || []).map((item) => item.itemKey).filter(Boolean),
      ...(callbackNonTenRecords || []).map((item) => item.itemKey).filter(Boolean),
    ],
    [recommendations, callbackNonTenRecords],
  )
  const visitCount = currentKeys.filter((key) => decisions.get(key)?.needCustomerVisit).length
  const traceCount = currentKeys.filter((key) => decisions.get(key)?.needInternalTrace).length

  const persistDecision = async (itemKey, sourceType, patch) => {
    const current = decisionOf(decisions, itemKey)
    const next = { ...current, ...patch, sourceType, itemKey }
    setDecisions((prev) => {
      const map = new Map(prev)
      map.set(itemKey, next)
      return map
    })
    if (!canEdit) return
    setSavingKey(itemKey)
    try {
      await upsertPostUseCallbackDecisions([next])
    } catch (error) {
      setDecisions((prev) => {
        const map = new Map(prev)
        const latest = map.get(itemKey)
        if (
          latest?.needCustomerVisit === next.needCustomerVisit &&
          latest?.needInternalTrace === next.needInternalTrace
        ) {
          map.set(itemKey, current)
        }
        return map
      })
      message.error(error?.message || '保存勾选失败')
    } finally {
      setSavingKey('')
    }
  }

  const flagColumn = (flag, title) => ({
    title,
    dataIndex: flag,
    width: 108,
    fixed: 'right',
    render: (_value, row) => (
      <Checkbox
        checked={Boolean(decisionOf(decisions, row.itemKey)[flag])}
        disabled={!canEdit || savingKey === row.itemKey}
        onChange={(event) =>
          persistDecision(row.itemKey, row.sourceType, { [flag]: event.target.checked })
        }
      />
    ),
  })

  const questionnaireColumns = [
    { title: '数据月份', dataIndex: 'importMonths', width: 110, render: (value) => (value || []).filter(Boolean).join('、') },
    { title: '客户名称', dataIndex: 'customerName', width: 160, ellipsis: true },
    { title: '客户编码', dataIndex: 'customerCode', width: 140, ellipsis: true },
    { title: '产品名称', dataIndex: 'productName', width: 140, ellipsis: true },
    { title: '建议触发类型', dataIndex: 'triggerType', width: 150, ellipsis: true },
    { title: '7分以下总次数', dataIndex: 'lowScoreLt7Count', width: 120 },
    { title: '7分以下分布', dataIndex: 'scoreBreakdown', width: 240, ellipsis: true },
    { title: '最近反馈时间', dataIndex: 'latestFeedbackAt', width: 170, ellipsis: true },
    { title: '涉及渠道', dataIndex: 'channels', width: 160, render: (value) => (value || []).join('；') },
    { title: '反馈原因', dataIndex: 'feedbackReasonSummary', width: 220, ellipsis: true },
    { title: '建议回访原因', dataIndex: 'recommendedReason', width: 260, ellipsis: true },
    flagColumn('needCustomerVisit', '客服回访'),
    flagColumn('needInternalTrace', '部门内溯源'),
  ]

  const callbackColumns = [
    { title: '具体投诉产品', dataIndex: 'productName', width: 140, ellipsis: true },
    { title: '原工单编号', dataIndex: 'originalTicketId', width: 150, ellipsis: true },
    { title: '投诉整体服务评价', dataIndex: 'score', width: 140 },
    { title: '客户名称', dataIndex: 'customerName', width: 150, ellipsis: true },
    { title: '集团客户编码', dataIndex: 'customerCode', width: 140, ellipsis: true },
    { title: '不满原因', dataIndex: 'dissatisfactionReason', width: 180, ellipsis: true },
    { title: '客户请求内容', dataIndex: 'customerRequest', width: 200, ellipsis: true },
    { title: '问题原因', dataIndex: 'problemCause', width: 200, ellipsis: true },
    flagColumn('needCustomerVisit', '客服回访'),
    flagColumn('needInternalTrace', '部门内溯源'),
  ]

  const exportVisit = () => {
    const rows = collectFollowupExportRows(recommendations, callbackNonTenRecords, decisions, 'needCustomerVisit')
    if (!rows.length) {
      message.info('请先勾选需要客服回访的记录')
      return
    }
    downloadFollowupTableExcel(rows, '待客服回访表', scopeLabel)
  }

  const exportTrace = () => {
    const rows = collectFollowupExportRows(recommendations, callbackNonTenRecords, decisions, 'needInternalTrace')
    if (!rows.length) {
      message.info('请先勾选需要部门内溯源的记录')
      return
    }
    downloadFollowupTableExcel(rows, '待内部提单表', scopeLabel)
  }

  const archiveTrace = async () => {
    const rows = collectFollowupExportRows(recommendations, callbackNonTenRecords, decisions, 'needInternalTrace')
    if (!rows.length) {
      message.info('请先勾选需要部门内溯源的记录')
      return
    }
    setArchiving(true)
    try {
      const saved = await archivePostUseJiraItems(rows.map(toJiraArchivePayload))
      message.success(`已存档 ${saved?.items?.length || rows.length} 条到用后即评JIRA`)
    } catch (error) {
      message.error(error?.message || '存档失败')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <Modal
      title="查看并处理建议回访/溯源清单"
      open={open}
      onCancel={onClose}
      width={1200}
      footer={null}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary" className="!mb-3">
        可同时勾选客服回访与部门内溯源。勾选会保存，导出与一键存档只处理已勾选的记录。
      </Typography.Paragraph>
      <Tabs
        items={[
          {
            key: 'questionnaire',
            label: `官网问卷类建议回访（${recommendations.length}）`,
            children: (
              <Table
                size="small"
                rowKey={(row) => row.itemKey || `${row.customerCode}-${row.productName}`}
                loading={loading}
                pagination={{ pageSize: 8 }}
                scroll={{ x: 2100 }}
                dataSource={recommendations}
                columns={questionnaireColumns}
                locale={{ emptyText: '当前范围内暂无官网问卷类建议回访记录' }}
              />
            ),
          },
          {
            key: 'callback',
            label: `投诉回访非10分（${callbackNonTenRecords.length}）`,
            children: (
              <Table
                size="small"
                rowKey={(row) => row.itemKey || row.id || row.originalTicketId}
                loading={loading}
                pagination={{ pageSize: 8 }}
                scroll={{ x: 1800 }}
                dataSource={callbackNonTenRecords}
                columns={callbackColumns}
                locale={{ emptyText: '当前范围内暂无投诉回访非10分记录' }}
              />
            ),
          },
        ]}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Typography.Text type="secondary">
          已勾选客服回访 {visitCount} 条 · 部门内溯源 {traceCount} 条
        </Typography.Text>
        <Space wrap>
          <Tooltip title="下载当前范围的双表原始清单">
            <Button
              icon={<DownloadOutlined />}
              onClick={() =>
                downloadPostUseCallbackRecommendationsExcel(
                  recommendations,
                  callbackNonTenRecords,
                  scopeLabel,
                )
              }
            >
              下载原始清单
            </Button>
          </Tooltip>
          <Button icon={<DownloadOutlined />} onClick={exportVisit}>
            导出待客服回访表
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportTrace}>
            导出待内部提单表
          </Button>
          <Tooltip title={canEdit ? '' : '仅管理员与体验运营可处理清单并存档'}>
            <Button
              type="primary"
              icon={<FolderAddOutlined />}
              loading={archiving}
              disabled={!canEdit}
              onClick={() => void archiveTrace()}
            >
              一键存档待内部提单
            </Button>
          </Tooltip>
        </Space>
      </div>
    </Modal>
  )
}
