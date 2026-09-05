import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import { useInsights } from '../../context/InsightsContext.jsx'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import {
  listPlaybookPromotionCandidates,
  loadPlaybookPromotionState,
  playbookCandidateKey,
  savePlaybookPromotionState,
} from '../../lib/learning/playbookPromotion.js'
import {
  loadPlaybookOverrides,
  mergePlaybookCandidateIntoOverlay,
  savePlaybookOverrides,
} from '../../lib/learning/playbookOverrides.js'
import { setPlaybookOverlayCache } from '../../lib/planningConfigLoader.js'
import { listAllFeedbacks } from '../../storage/feedbackStore.js'

export default function PlaybookPromotionPanel() {
  const { adapter, feedbacks, markSnapshotsStale } = useInsights()
  const message = useAppMessage()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [state, setState] = useState({ rejectedKeys: [], approvedKeys: [] })
  const [editing, setEditing] = useState(null)
  const [editText, setEditText] = useState('')

  const refresh = useCallback(async () => {
    if (!adapter) return
    setLoading(true)
    try {
      let records = feedbacks
      try {
        const all = await listAllFeedbacks(adapter)
        if (all?.length) records = all
      } catch {
        /* 当前周期 */
      }
      const nextState = await loadPlaybookPromotionState(adapter)
      setState(nextState)
      setRows(listPlaybookPromotionCandidates(records, nextState))
    } catch (err) {
      console.warn('[learning] 加载举措沉淀失败', err)
      message.error('加载举措沉淀失败')
    } finally {
      setLoading(false)
    }
  }, [adapter, feedbacks, message])

  useEffect(() => {
    refresh()
  }, [refresh])

  const approveRow = async (row, text) => {
    const overlay = await loadPlaybookOverrides(adapter)
    const nextOverlay = mergePlaybookCandidateIntoOverlay(overlay, { ...row, text })
    await savePlaybookOverrides(adapter, nextOverlay)
    setPlaybookOverlayCache(nextOverlay)
    const key = playbookCandidateKey(row)
    const nextState = {
      rejectedKeys: state.rejectedKeys,
      approvedKeys: [...new Set([...(state.approvedKeys || []), key])],
    }
    await savePlaybookPromotionState(adapter, nextState)
    setState(nextState)
    markSnapshotsStale?.()
    message.success('已写入 Playbook，刷新洞察后行动建议会使用该举措')
    await refresh()
  }

  const rejectRow = async (row) => {
    const key = playbookCandidateKey(row)
    const nextState = {
      approvedKeys: state.approvedKeys,
      rejectedKeys: [...new Set([...(state.rejectedKeys || []), key])],
    }
    await savePlaybookPromotionState(adapter, nextState)
    setState(nextState)
    await refresh()
  }

  return (
    <div className="space-y-4">
      <PageIntro />
      <Card>
        <Space className="mb-4">
          <Button onClick={refresh} loading={loading}>
            刷新候选
          </Button>
        </Space>
        <Table
          rowKey={(row) => playbookCandidateKey(row)}
          size="small"
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: '产品', dataIndex: 'product', width: 140, ellipsis: true },
            { title: '旅程 L2', dataIndex: 'journeyL2', width: 140, ellipsis: true },
            { title: '问题类型', dataIndex: 'problemType', width: 140, ellipsis: true },
            {
              title: '确立举措',
              dataIndex: 'text',
              render: (v) => <Typography.Paragraph className="mb-0" ellipsis={{ rows: 2 }}>{v}</Typography.Paragraph>,
            },
            {
              title: '频次',
              key: 'freq',
              width: 110,
              render: (_, row) => (
                <span>
                  {row.count} 单
                  <Tag className="ml-1">{row.distinctMonths} 月</Tag>
                </span>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 200,
              render: (_, row) => (
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => {
                      setEditing(row)
                      setEditText(row.text)
                    }}
                  >
                    采纳
                  </Button>
                  <Button size="small" onClick={() => rejectRow(row)}>
                    拒绝
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title="编辑后写入 Playbook"
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={async () => {
          if (!editing) return
          await approveRow(editing, editText.trim() || editing.text)
          setEditing(null)
        }}
        okText="写入 Playbook"
      >
        <Typography.Paragraph type="secondary" className="text-xs">
          可改写成可复用的产品话术，再沉淀为跨周期模板。
        </Typography.Paragraph>
        <Input.TextArea rows={5} value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={200} />
      </Modal>
    </div>
  )
}

function PageIntro() {
  return (
    <Alert
      type="info"
      showIcon
      title="将高频确立举措沉淀为 Playbook"
      description="同一产品 + 旅程 + 问题类型下，相同确立举措达到 3 单且跨 2 个月后出现在此。采纳后写入托管 Playbook，刷新洞察后的行动建议会复用；不自动改仓库里的 playbook.json。"
    />
  )
}
