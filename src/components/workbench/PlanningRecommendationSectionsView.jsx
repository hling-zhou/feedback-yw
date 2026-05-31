import { Typography } from 'antd'
import {
  CLUSTER_SUB_LABELS,
  PLANNING_SECTION_LABELS,
} from '../../lib/planningRecommendationSections.js'
import {
  normalizeClusterRootCause,
  normalizeSectionsForDisplay,
  normalizeVerification,
  SHOW_PLANNING_OPPORTUNITIES,
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
      : variant === 'verify'
        ? 'bg-emerald-50/40 border-emerald-100'
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
  const verification = normalizeVerification(normalized.verification)
  const painScores = normalized.painClusterScores
  const hasCluster =
    cluster &&
    (cluster.contextNote ||
      cluster.dataMetrics?.length ||
      cluster.painClusters?.length ||
      cluster.rootCauses?.length ||
      cluster.businessImpact)
  const hasProduct = (normalized.productActions?.length ?? 0) > 0
  const hasService = (normalized.serviceActions?.length ?? 0) > 0
  const hasActions = hasProduct || hasService

  return (
    <div className="mb-2 space-y-2.5">
      {painScores && (
        <SectionBlock title="优先级评定（V2 痛点聚类）">
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
            <li>
              <Typography.Text className="block text-[11px] font-medium text-gray-600">
                当前痛点
              </Typography.Text>
              {normalized.executiveSummary || '—'}
            </li>
          </ul>
        </SectionBlock>
      )}

      {hasCluster && (
        <SectionBlock title={PLANNING_SECTION_LABELS.clusterRootCause}>
          {cluster.contextNote && (
            <Typography.Text className="mb-1 block text-sm text-gray-700">
              {cluster.contextNote}
            </Typography.Text>
          )}
          {cluster.dataMetrics?.length ? (
            <SubBlock title={CLUSTER_SUB_LABELS.dataMetrics}>
              <BulletList items={cluster.dataMetrics} />
            </SubBlock>
          ) : null}
          {cluster.painClusters?.length ? (
            <SubBlock title={CLUSTER_SUB_LABELS.painClusters}>
              <ul className="mb-0 list-none space-y-1 pl-0 text-sm leading-relaxed text-gray-700">
                {cluster.painClusters.map((p) => (
                  <li key={p.text}>
                    「{p.text}」<Typography.Text type="secondary"> {p.count} 单</Typography.Text>
                  </li>
                ))}
              </ul>
            </SubBlock>
          ) : null}
          {cluster.rootCauses?.length ? (
            <SubBlock title={CLUSTER_SUB_LABELS.rootCauses}>
              <ul className="mb-0 list-none space-y-1 pl-0 text-sm leading-relaxed text-gray-700">
                {cluster.rootCauses.map((r) => (
                  <li key={r.text}>
                    「{r.text}」<Typography.Text type="secondary"> {r.count} 单</Typography.Text>
                  </li>
                ))}
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

      {SHOW_PLANNING_OPPORTUNITIES && normalized.opportunities && (
        <SectionBlock title={PLANNING_SECTION_LABELS.opportunities}>
          <Typography.Text className="text-sm leading-relaxed text-gray-700">
            {normalized.opportunities}
          </Typography.Text>
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

      {verification && (verification.metrics?.length || verification.userValidation) && (
        <SectionBlock title={PLANNING_SECTION_LABELS.verification} variant="verify">
          {verification.metrics?.length ? (
            <SubBlock title="指标监控">
              <Typography.Text className="text-sm leading-relaxed text-gray-700">
                {verification.metrics.join('、')}
              </Typography.Text>
            </SubBlock>
          ) : null}
          {verification.userValidation ? (
            <SubBlock title="用户验证">
              <Typography.Text className="text-sm leading-relaxed text-gray-700">
                {verification.userValidation}
              </Typography.Text>
            </SubBlock>
          ) : null}
        </SectionBlock>
      )}
    </div>
  )
}
