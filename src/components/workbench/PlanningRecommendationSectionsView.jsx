import { Typography, Tag } from 'antd'
import {
  CLUSTER_SUB_LABELS,
  PLANNING_SECTION_LABELS,
} from '../../lib/planningRecommendationSections.js'
import {
  normalizeClusterRootCause,
  normalizeSectionsForDisplay,
  PAIN_CLUSTER_SECTION_TITLE,
} from '../../lib/planningRecommendationDisplay.js'

/** @typedef {import('../../domain/overviewConclusions.js').PlanningRecommendationSections} PlanningRecommendationSections */

/**
 * @param {Object} props
 * @param {PlanningRecommendationSections} props.sections
 */
function SectionBlock({ title, children, variant = 'default' }) {
  const bg =
    variant === 'actions'
      ? 'bg-indigo-50/40 border-indigo-100'
      : 'bg-gray-50/80 border-gray-200'

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${bg}`}>
      <Typography.Text strong className="mb-1.5 block text-xs text-gray-700">
        {title}
      </Typography.Text>
      {children}
    </div>
  )
}

/**
 * @param {Object} props
 * @param {string} props.title
 */
function SubBlock({ title, children }) {
  return (
    <div className="mt-2 first:mt-0">
      <Typography.Text className="mb-1 block text-[11px] font-medium text-gray-600">
        {title}
      </Typography.Text>
      {children}
    </div>
  )
}

/**
 * @param {Object} props
 * @param {string[]} props.items
 */
function BulletList({ items }) {
  if (!items.length) return null
  return (
    <ul className="mb-0 list-disc space-y-1 pl-4 text-sm leading-relaxed text-gray-700">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

/**
 * @param {Object} props
 * @param {PlanningRecommendationSections} props.sections
 */
export default function PlanningRecommendationSectionsView({ sections }) {
  const normalized = normalizeSectionsForDisplay(sections) || sections
  const cluster = normalizeClusterRootCause(normalized.clusterRootCause)
  const painScores = normalized.painClusterScores
  const hasCluster = cluster && (cluster.painClusters?.length || cluster.businessImpact)
  const hasProduct = (normalized.productActions?.length ?? 0) > 0
  const hasService = (normalized.serviceActions?.length ?? 0) > 0
  const hasActions = hasProduct || hasService

  return (
    <div className="mb-2 space-y-2.5">
      {painScores && (
        <SectionBlock title={PAIN_CLUSTER_SECTION_TITLE}>
          <Typography.Text type="secondary" className="mb-2 block text-[11px]">
            本卡片对应 1 个最终痛点群组（二次聚类结果），下列为群组内优先级评分。
          </Typography.Text>
          <ul className="mb-0 list-none space-y-1 pl-0 text-sm leading-relaxed text-gray-700">
            <li>
              优先级得分：{painScores.priorityScore} 分（排名：{painScores.rank}/
              {painScores.totalFinal}）
            </li>
            <li>
              影响广度：{painScores.breadthScore} 分（占比{painScores.sharePct}%，工单
              {painScores.ticketCount} 件）
            </li>
            <li>
              业务危害度：{painScores.harmScore} 分（最高严重度 {painScores.maxSeverity}，P90
              情绪 {painScores.p90Emotion}）
            </li>
            {painScores.sourceDistributionLines?.length ? (
              <li>
                <Typography.Text className="block text-[11px] font-medium text-gray-600">
                  来源与一级环节分布
                </Typography.Text>
                <ul className="mb-0 mt-1 list-disc space-y-0.5 pl-4">
                  {painScores.sourceDistributionLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </li>
            ) : null}
            <li>高价值客户影响：{painScores.customerTierSummary}</li>
          </ul>
        </SectionBlock>
      )}

      {hasCluster && (
        <SectionBlock title={PLANNING_SECTION_LABELS.clusterRootCause}>
          {cluster.causeLabel ? (
            <div className="mb-2 text-sm leading-relaxed text-gray-700">
              <Typography.Text className="text-[11px] font-medium text-gray-600">
                问题原因类名：
              </Typography.Text>{' '}
              <span className="font-medium">{cluster.causeLabel}</span>
            </div>
          ) : null}
          {cluster.painClusters?.length ? (
            <SubBlock title={`簇内不同表象 Top ${cluster.painClusters.length}（非类名，仅作证据）`}>
              <ul className="mb-0 list-none space-y-1.5 pl-0 text-sm leading-relaxed text-gray-700">
                {cluster.painClusters.map((p) => {
                  const sharePct =
                    p.sharePct != null
                      ? p.sharePct
                      : painScores?.ticketCount
                        ? Math.round((p.count / painScores.ticketCount) * 100)
                        : null
                  return (
                  <li key={p.text} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span>
                      「{p.text}」
                      <Typography.Text type="secondary">
                        {' '}
                        {p.count} 单
                        {sharePct != null ? `（${sharePct}%）` : ''}
                      </Typography.Text>
                    </span>
                    {p.isRepresentative ? (
                      <Tag bordered={false} color="processing" className="!text-[10px]">
                        代表表象
                      </Tag>
                    ) : null}
                  </li>
                  )
                })}
              </ul>
            </SubBlock>
          ) : null}
          {cluster.businessImpact ? (
            <SubBlock title={CLUSTER_SUB_LABELS.businessImpact}>
              <Typography.Text className="text-sm leading-relaxed text-gray-700">
                {cluster.businessImpact}
              </Typography.Text>
            </SubBlock>
          ) : null}
        </SectionBlock>
      )}

      {hasActions && (
        <SectionBlock title="可执行改进建议" variant="actions">
          <div className="space-y-2">
            {hasProduct && (
              <div>
                <Typography.Text className="mb-1 block text-[11px] font-medium text-indigo-800">
                  {PLANNING_SECTION_LABELS.productActions}
                </Typography.Text>
                <BulletList items={normalized.productActions || []} />
              </div>
            )}
            {hasService && (
              <div>
                <Typography.Text className="mb-1 block text-[11px] font-medium text-indigo-800">
                  {PLANNING_SECTION_LABELS.serviceActions}
                </Typography.Text>
                <BulletList items={normalized.serviceActions || []} />
              </div>
            )}
          </div>
        </SectionBlock>
      )}
    </div>
  )
}
