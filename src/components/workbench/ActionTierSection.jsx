import { useState } from 'react'
import { Collapse, Typography, Badge } from 'antd'
import { CaretRightOutlined } from '@ant-design/icons'
import ProblemCard from './ProblemCard.jsx'

/** @typedef {import('../../domain/overviewConclusions.js').ActionRecsResult} ActionRecsResult */

const TIER_ORDER = ['structural', 'change', 'sharp', 'iteration', 'tail', 'cross']
const TIER_LABELS = {
  structural: '持续高频',
  change: '环比突增',
  sharp: '少数高发',
  iteration: '常规优化',
  tail: '零散长尾',
  cross: '共性关注',
}

/**
 * 单层容器，标题 + 卡片列表，可折叠。
 *
 * @param {Object} props
 * @param {string} props.tier
 * @param {ActionRecsResult[]} props.recs
 * @param {(rec: ActionRecsResult) => void} [props.onCardClick]
 * @param {boolean} [props.defaultOpen=true]
 */
export default function ActionTierSection({ tier, recs, onCardClick, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)

  if (!recs.length) return null

  return (
    <div className="mb-3">
      <div
        className="flex items-center gap-2 cursor-pointer select-none py-1"
        onClick={() => setOpen(!open)}
      >
        <CaretRightOutlined
          className="transition-transform text-xs text-gray-400"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
        />
        <Typography.Text strong className="text-sm">
          {TIER_LABELS[tier] || tier}
        </Typography.Text>
        <Badge count={recs.length} className="!bg-gray-200 !text-gray-600" />
      </div>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-2">
          {recs.map((rec) => (
            <ProblemCard key={rec.id} rec={rec} onClick={onCardClick} />
          ))}
        </div>
      )}
    </div>
  )
}
