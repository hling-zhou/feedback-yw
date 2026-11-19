import { useState } from 'react'
import { Button, Descriptions, Typography, message } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { apiFetch } from '../../lib/apiClient.js'
import { useAuth } from '../../context/AuthContext.jsx'

/**
 * 用后即评「优化建议（自动生成）」共享模块（2026-11-19，
 * DESIGN-用后即评抽屉优化建议-20261119 §6）。
 *
 * 省代表回访（PostUseVisitDrawer）与产品部回溯（PostUseJiraDrawer）引用同一实现
 * （同源判定纪律：两处呈现一个概念，禁止各写一份）。
 * - 行文案对齐工单抽屉：产品/技术优化（自动）恒显（空显 '—'）；
 *   服务/流程改进（自动）有值才显。
 * - 来源 Tag 空内容时不显示（没生成过标「规则」= 来源失真）。
 * - 单条生成按钮 = retag 权限 + 无内容时显示；批量任务进行中接口 409。
 *
 * @param {object} props
 * @param {Record<string, any> | null} props.entity 实体（visit record 或 trace item）
 * @param {'visit' | 'trace'} props.entityType
 * @param {boolean} props.open 抽屉 open 态（生成后刷新用）
 * @param {(entity: Record<string, any>) => void} props.onUpdated 写回成功回调（宿主更新本地态）
 * @param {() => void} [props.onPendingCountChanged] 生成后待生成计数可能变化（宿主刷新计数）
 */
export default function PostUseOptimizationSection({ entity, entityType, open, onUpdated, onPendingCountChanged }) {
  const { can } = useAuth()
  const [generating, setGenerating] = useState(false)

  const productText = String(entity?.optimizationProduct || '').trim()
  const serviceText = String(entity?.optimizationService || '').trim()
  const source = String(entity?.optimizationSource || '').trim()
  const canGenerate = can('retag') && !productText && !serviceText

  const handleGenerate = async () => {
    if (!entity?.id || generating) return
    setGenerating(true)
    try {
      const res = await apiFetch('/api/post-use-optimization', {
        method: 'POST',
        body: JSON.stringify({ entityType, id: entity.id }),
      })
      if (res?.ok && res.item) {
        message.success(res.skipped ? '未产出建议（无语料或规则未命中）' : '优化建议已生成')
        onUpdated?.(res.item)
        onPendingCountChanged?.()
      } else {
        message.error(res?.error || '生成失败，请重试')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '生成失败，请重试')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Typography.Text type="secondary">优化建议（自动生成）</Typography.Text>
        {open && canGenerate ? (
          <Button
            type="link"
            size="small"
            className="!h-auto !px-0 !py-0 text-xs"
            icon={<ThunderboltOutlined />}
            loading={generating}
            onClick={() => void handleGenerate()}
          >
            生成
          </Button>
        ) : null}
      </div>
      <Descriptions
        size="small"
        column={1}
        className="mt-2"
        bordered
        labelStyle={{ whiteSpace: 'nowrap' }}
      >
        <Descriptions.Item label="产品/技术优化（自动）">
          {productText ? (
            <span className="whitespace-pre-wrap">{productText}</span>
          ) : '—'}
        </Descriptions.Item>
        {serviceText ? (
          <Descriptions.Item label="服务/流程改进（自动）">
            <span className="whitespace-pre-wrap">{serviceText}</span>
          </Descriptions.Item>
        ) : null}
      </Descriptions>
      {source === 'llm' || source === 'rule' ? (
        <Typography.Text type="secondary" className="mt-1 block text-xs">
          来源：{source === 'llm' ? '大模型' : '规则'} · 重新生成以最新语料覆盖
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary" className="mt-1 block text-xs">
          未生成，可通过列表页或右上按钮生成
        </Typography.Text>
      )}
    </div>
  )
}
