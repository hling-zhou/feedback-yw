import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Modal, Select, Space, Table, Tabs, Tooltip, Typography, message } from 'antd'
import { DownloadOutlined, FolderAddOutlined, MailOutlined } from '@ant-design/icons'
import { downloadPostUseCallbackRecommendationsExcel } from '../../lib/postUseRating/callbackRecommendationsExport.js'
import {
  buildFollowupTableWorkbook,
  collectFollowupExportRows,
  downloadFollowupTableExcel,
  followupTableFilename,
  followupWorkbookToBase64,
  toJiraArchivePayload,
} from '../../lib/postUseRating/callbackFollowupTables.js'
import SendMailModal from '../mail/SendMailModal.jsx'
import { MAIL_PRESET_CALLBACK_VISIT } from '../../domain/mail.js'
import KeyCustomerStar from '../common/KeyCustomerStar.jsx'
import {
  archivePostUseJiraItems,
  listAssignees,
  listPostUseCallbackDecisions,
  upsertPostUseCallbackDecisions,
} from '../../lib/postUseJiraClient.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { canUsePostUseCallbackList } from '../../domain/auth/permissions.js'

function decisionOf(map, itemKey) {
  return map.get(itemKey) || { needCustomerVisit: false, needInternalTrace: false }
}

function EllipsisHover({ value }) {
  const text = String(value ?? '').trim()
  if (!text) return '—'
  return (
    <Tooltip title={<span className="whitespace-pre-line">{text}</span>} getPopupContainer={() => document.body}>
      <span className="block max-w-full truncate">{text}</span>
    </Tooltip>
  )
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {object[]} props.recommendations
 * @param {object[]} props.callbackNonTenRecords
 * @param {string} [props.scopeLabel]
 * @param {(originalTicketId: string) => void} [props.onOpenTicket]
 */
export default function PostUseCallbackProcessModal({
  open,
  onClose,
  recommendations = [],
  callbackNonTenRecords = [],
  scopeLabel = '当前范围',
  onOpenTicket,
}) {
  const { user } = useAuth()
  const canEdit = canUsePostUseCallbackList(user?.role)
  const [decisions, setDecisions] = useState(() => new Map())
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [mailOpen, setMailOpen] = useState(false)
  /** 经办人候选列表 */
  const [assignees, setAssignees] = useState(/** @type {{ id: string; username: string; team: string }[]} */ ([]))
  /** itemKey → { id, username } */
  const [assigneeOverrides, setAssigneeOverrides] = useState(() => new Map())

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listAssignees()
      .then((res) => {
        if (!cancelled) setAssignees(res?.users || [])
      })
      .catch(() => {
        if (!cancelled) setAssignees([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const assigneeOptions = useMemo(
    () => assignees.map((person) => ({ label: person.username, value: person.id })),
    [assignees],
  )

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

  // 按客户批量勾选：一次 API 调用持久化同一客户下所有产品的 itemKey
  const persistDecisionsBatch = async (itemKeys, sourceType, patch) => {
    const items = itemKeys.map((itemKey) => ({
      ...decisionOf(decisions, itemKey),
      ...patch,
      sourceType,
      itemKey,
    }))
    setDecisions((prev) => {
      const map = new Map(prev)
      for (const item of items) map.set(item.itemKey, item)
      return map
    })
    if (!canEdit) return
    setSavingKey(items[0]?.itemKey || '')
    try {
      await upsertPostUseCallbackDecisions(items)
    } catch (error) {
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

  // 官网问卷类按客户聚合：同一客户的多产品分行展示，客户级列合并单元格。
  // 行内顺序：先按客户（customerCode || customerName），再按产品名，保证同客户相邻以便 rowSpan。
  const questionnaireRows = useMemo(() => {
    const keyOf = (row) => String(row.customerCode || row.customerName || '').trim() || '匿名客户'
    return [...(recommendations || [])].sort(
      (a, b) =>
        keyOf(a).localeCompare(keyOf(b), 'zh')
        || String(a.productName || '').localeCompare(String(b.productName || ''), 'zh'),
    )
  }, [recommendations])

  // 每个客户分组的 rowSpan（首行=组内行数，后续行=0）与该组的 itemKey 列表
  const { questionnaireSpan, questionnaireGroupKeys } = useMemo(() => {
    const keyOf = (row) => String(row.customerCode || row.customerName || '').trim() || '匿名客户'
    const spans = new Array(questionnaireRows.length).fill(0)
    /** @type {Record<number, string[]>} index → 该客户分组所有 itemKey */
    const groupKeys = {}
    for (let i = 0; i < questionnaireRows.length; i++) {
      if (i > 0 && keyOf(questionnaireRows[i]) === keyOf(questionnaireRows[i - 1])) continue
      let span = 1
      const keys = []
      for (let j = i; j < questionnaireRows.length && keyOf(questionnaireRows[j]) === keyOf(questionnaireRows[i]); j++) {
        span += i === j ? 0 : 1
        if (questionnaireRows[j].itemKey) keys.push(questionnaireRows[j].itemKey)
      }
      spans[i] = span
      groupKeys[i] = keys
    }
    return { questionnaireSpan: spans, questionnaireGroupKeys: groupKeys }
  }, [questionnaireRows])

  const mergedCell = (value, index, render) => {
    const span = questionnaireSpan[index]
    if (span === 0) return { children: '', props: { rowSpan: 0 } }
    return { children: render ? render(value) : value, props: { rowSpan: span } }
  }

  const mergedFlagColumn = (flag, title) => ({
    title,
    width: 108,
    fixed: 'right',
    render: (_value, _row, index) => {
      const span = questionnaireSpan[index]
      if (span === 0) return { children: '', props: { rowSpan: 0 } }
      const keys = questionnaireGroupKeys[index] || []
      const checkedList = keys.map((k) => Boolean(decisionOf(decisions, k)[flag]))
      const allChecked = checkedList.length > 0 && checkedList.every(Boolean)
      const someChecked = checkedList.some(Boolean)
      return {
        children: (
          <Checkbox
            checked={allChecked}
            indeterminate={!allChecked && someChecked}
            disabled={!canEdit || savingKey === (keys[0] || '')}
            onChange={(event) =>
              persistDecisionsBatch(keys, 'questionnaire', { [flag]: event.target.checked })
            }
          />
        ),
        props: { rowSpan: span },
      }
    },
  })

  const questionnaireColumns = [
    { title: '数据月份', dataIndex: 'importMonths', width: 110, render: (value) => (value || []).filter(Boolean).join('、') },
    {
      title: '客户名称',
      dataIndex: 'customerName',
      width: 160,
      ellipsis: true,
      render: (value, row, index) => mergedCell(<span>{value}<KeyCustomerStar isKeyCustomer={row.isKeyCustomer} /></span>, index),
    },
    {
      title: '客户编码',
      dataIndex: 'customerCode',
      width: 140,
      ellipsis: true,
      render: (value, _row, index) => mergedCell(value || '—', index),
    },
    { title: '产品名称', dataIndex: 'productName', width: 140, ellipsis: true },
    {
      title: '建议触发类型',
      dataIndex: 'triggerType',
      width: 150,
      ellipsis: true,
      render: (value, _row, index) => mergedCell(value || '—', index),
    },
    { title: '7分以下总次数', dataIndex: 'lowScoreLt7Count', width: 120 },
    { title: '7分以下分布', dataIndex: 'scoreBreakdown', width: 240, ellipsis: true },
    { title: '最近反馈时间', dataIndex: 'latestFeedbackAt', width: 170, ellipsis: true },
    { title: '涉及渠道', dataIndex: 'channels', width: 160, render: (value) => (value || []).join('；') },
    {
      title: '反馈原因',
      dataIndex: 'feedbackReasonSummary',
      width: 220,
      ellipsis: true,
      render: (value) => <EllipsisHover value={value} />,
    },
    {
      title: '建议回访原因',
      dataIndex: 'recommendedReason',
      width: 260,
      ellipsis: true,
      render: (value) => <EllipsisHover value={value} />,
    },
    mergedFlagColumn('needCustomerVisit', '客服部回访'),
    mergedFlagColumn('needInternalTrace', '产品部溯源'),
    {
      title: '产品部溯源经办人',
      key: '__assignee',
      width: 140,
      render: (_v, _row, index) => {
        const span = questionnaireSpan[index]
        if (span === 0) return { children: '', props: { rowSpan: 0 } }
        const keys = questionnaireGroupKeys[index] || []
        const traced = keys.some((k) => decisionOf(decisions, k).needInternalTrace)
        if (!traced) {
          return { children: '—', props: { rowSpan: span } }
        }
        const firstKey = keys[0] || ''
        const current = assigneeOverrides.get(firstKey)
        return {
          children: (
            <Select
              showSearch
              size="small"
              className="w-full"
              placeholder="经办人"
              value={current?.id || undefined}
              options={assigneeOptions}
              filterOption={(input, option) =>
                String(option?.label || '').toLowerCase().includes(input.toLowerCase())
              }
              onChange={(value) => {
                const person = assignees.find((p) => p.id === value)
                setAssigneeOverrides((prev) => {
                  const map = new Map(prev)
                  for (const key of keys) {
                    if (person) map.set(key, { id: person.id, username: person.username })
                    else map.delete(key)
                  }
                  return map
                })
              }}
            />
          ),
          props: { rowSpan: span },
        }
      },
    },
  ]

  const callbackColumns = [
    { title: '具体投诉产品', dataIndex: 'productName', width: 140, ellipsis: true },
    {
      title: '原工单编号',
      dataIndex: 'originalTicketId',
      width: 180,
      render: (value) => {
        if (!value) return '—'
        if (!onOpenTicket) return value
        return (
          <Button type="link" size="small" className="!px-0" onClick={() => onOpenTicket(value)}>
            {value}
          </Button>
        )
      },
    },
    { title: '投诉整体服务评价', dataIndex: 'score', width: 140 },
    { title: '客户名称', dataIndex: 'customerName', width: 150, ellipsis: true, render: (value, row) => <span>{value}<KeyCustomerStar isKeyCustomer={row.isKeyCustomer} /></span> },
    { title: '集团客户编码', dataIndex: 'customerCode', width: 140, ellipsis: true },
    { title: '不满原因', dataIndex: 'dissatisfactionReason', width: 180, ellipsis: true },
    { title: '客户请求内容', dataIndex: 'customerRequest', width: 200, ellipsis: true },
    { title: '问题原因', dataIndex: 'problemCause', width: 200, ellipsis: true },
    flagColumn('needCustomerVisit', '客服部回访'),
    flagColumn('needInternalTrace', '产品部溯源'),
    {
      title: '产品部溯源经办人',
      key: '__assignee',
      width: 140,
      render: (_v, row) => {
        if (!decisionOf(decisions, row.itemKey).needInternalTrace) return '—'
        const current = assigneeOverrides.get(row.itemKey)
        return (
          <Select
            showSearch
            size="small"
            className="w-full"
            placeholder="经办人"
            value={current?.id || undefined}
            options={assigneeOptions}
            filterOption={(input, option) =>
              String(option?.label || '').toLowerCase().includes(input.toLowerCase())
            }
            onChange={(value) => {
              const person = assignees.find((p) => p.id === value)
              setAssigneeOverrides((prev) => {
                const map = new Map(prev)
                if (person) map.set(row.itemKey, { id: person.id, username: person.username })
                else map.delete(row.itemKey)
                return map
              })
            }}
          />
        )
      },
    },
  ]

  const exportVisit = () => {
    const rows = collectFollowupExportRows(recommendations, callbackNonTenRecords, decisions, 'needCustomerVisit')
    if (!rows.length) {
      message.info('请先勾选需要客服部回访的记录')
      return
    }
    downloadFollowupTableExcel(rows, '待客服部回访表', scopeLabel)
  }

  const exportTrace = () => {
    const rows = collectFollowupExportRows(recommendations, callbackNonTenRecords, decisions, 'needInternalTrace')
    if (!rows.length) {
      message.info('请先勾选需要产品部溯源的记录')
      return
    }
    downloadFollowupTableExcel(rows, '待产品部溯源表', scopeLabel)
  }

  const archiveTrace = async () => {
    const rows = collectFollowupExportRows(recommendations, callbackNonTenRecords, decisions, 'needInternalTrace')
    if (!rows.length) {
      message.info('请先勾选需要产品部溯源的记录')
      return
    }
    // 逐条校验：所有勾选产品部溯源的行必须指定经办人
    const missingAssigneeKeys = rows.filter((row) => !assigneeOverrides.get(row.itemKey)?.id)
    if (missingAssigneeKeys.length) {
      message.warning(`还有 ${missingAssigneeKeys.length} 条勾选产品部溯源的记录未指定经办人，请逐条指定后再存档`)
      return
    }
    setArchiving(true)
    try {
      const saved = await archivePostUseJiraItems(rows.map((row) => toJiraArchivePayload(row, assigneeOverrides)))
      message.success(
        `已存档 ${saved?.items?.length || rows.length} 条到「反馈库 · 用后即评满意度 · 产品部溯源」`,
      )
      setAssigneeOverrides(() => new Map())
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
        可同时勾选客服部回访与产品部溯源。勾选会保存，导出与一键存档只处理已勾选的记录。
      </Typography.Paragraph>
      <Tabs
        items={[
          {
            key: 'questionnaire',
            label: `官网问卷类建议回访(${recommendations.length})`,
            children: (
              <Table
                size="small"
                rowKey={(row) => row.itemKey || `${row.customerCode}-${row.productName}`}
                loading={loading}
                pagination={{ pageSize: 8 }}
                scroll={{ x: 2100 }}
                dataSource={questionnaireRows}
                columns={questionnaireColumns}
                locale={{ emptyText: '当前范围内暂无官网问卷类建议回访记录' }}
              />
            ),
          },
          {
            key: 'callback',
            label: `投诉回访非10分(${callbackNonTenRecords.length})`,
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
          已勾选客服部回访 {visitCount} 条 · 产品部溯源 {traceCount} 条
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
            导出待客服部回访表
          </Button>
          <Tooltip title={visitCount ? '' : '请先勾选需要客服部回访的记录'}>
            <Button
              icon={<MailOutlined />}
              disabled={!canEdit || !visitCount}
              onClick={() => setMailOpen(true)}
            >
              发送待客服部回访
            </Button>
          </Tooltip>
          <Button icon={<DownloadOutlined />} onClick={exportTrace}>
            导出待产品部溯源表
          </Button>
          <Tooltip title={canEdit ? '' : '仅管理员与体验运营可处理清单并存档'}>
            <Button
              type="primary"
              icon={<FolderAddOutlined />}
              loading={archiving}
              disabled={!canEdit}
              onClick={() => void archiveTrace()}
            >
              存档「产品部溯源」
            </Button>
          </Tooltip>
        </Space>
      </div>
      <SendMailModal
        open={mailOpen}
        onClose={() => setMailOpen(false)}
        defaultTemplateId={MAIL_PRESET_CALLBACK_VISIT}
        dataSourceType="post_use_rating"
        periodLabel={scopeLabel}
        linkKind="workbench"
        canSend={canEdit && visitCount > 0}
        disabledReason={visitCount ? '' : '请先勾选需要客服部回访的记录'}
        buildAttachment={async () => {
          const rows = collectFollowupExportRows(
            recommendations,
            callbackNonTenRecords,
            decisions,
            'needCustomerVisit',
          )
          if (!rows.length) return null
          const wb = buildFollowupTableWorkbook(rows, '待客服部回访表')
          return {
            filename: followupTableFilename('待客服部回访表', scopeLabel),
            mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            contentBase64: followupWorkbookToBase64(wb),
          }
        }}
      />
    </Modal>
  )
}
