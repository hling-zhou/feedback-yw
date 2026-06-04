import { Collapse, Tag, Typography } from 'antd'
import {
  SYSTEM_USAGE_WORKFLOW,
  SYSTEM_USAGE_WORKFLOW_TITLE,
} from '../../domain/systemWorkflow.js'

/** @typedef {'full' | 'compact'} SystemUsageWorkflowVariant */

/**
 * @param {Object} props
 * @param {SystemUsageWorkflowVariant} [props.variant]
 * @param {string} [props.className]
 */
export default function SystemUsageWorkflow({ variant = 'full', className = '' }) {
  if (variant === 'compact') {
    return (
      <Collapse
        className={className}
        bordered={false}
        items={[
          {
            key: 'workflow',
            label: (
              <span className="text-sm font-medium text-ink-800">{SYSTEM_USAGE_WORKFLOW_TITLE}</span>
            ),
            children: (
              <ol className="mb-0 space-y-3 pl-0">
                {SYSTEM_USAGE_WORKFLOW.map((item, index) => (
                  <WorkflowStep
                    key={item.step}
                    item={item}
                    tone="light"
                    showConnector={index < SYSTEM_USAGE_WORKFLOW.length - 1}
                  />
                ))}
              </ol>
            ),
          },
        ]}
      />
    )
  }

  return (
    <div className={className}>
      <Typography.Text className="mb-4 block text-xs font-medium uppercase tracking-wider text-white/50">
        {SYSTEM_USAGE_WORKFLOW_TITLE}
      </Typography.Text>
      <ol className="mb-0 space-y-0 pl-0">
        {SYSTEM_USAGE_WORKFLOW.map((item, index) => (
          <WorkflowStep
            key={item.step}
            item={item}
            tone="dark"
            showConnector={index < SYSTEM_USAGE_WORKFLOW.length - 1}
          />
        ))}
      </ol>
    </div>
  )
}

/**
 * @param {Object} props
 * @param {import('../../domain/systemWorkflow.js').SystemWorkflowStep} props.item
 * @param {'dark' | 'light'} props.tone
 * @param {boolean} [props.showConnector]
 */
function WorkflowStep({ item, tone, showConnector = false }) {
  const isDark = tone === 'dark'

  return (
    <li className="relative list-none pb-5 last:pb-0">
      {showConnector ? (
        <span
          className={
            isDark
              ? 'absolute left-[11px] top-7 bottom-0 w-px bg-white/20'
              : 'absolute left-[11px] top-7 bottom-0 w-px bg-ink-200'
          }
          aria-hidden
        />
      ) : null}

      <div className="flex gap-3">
        <span
          className={
            isDark
              ? 'relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-xs font-semibold text-white'
              : 'relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-xs font-semibold text-brand-700'
          }
        >
          {item.step}
        </span>

        <div className="min-w-0 flex-1 pt-0.5">
          <Typography.Text
            className={
              isDark
                ? 'block text-sm font-medium text-white/90'
                : 'block text-sm font-medium text-ink-900'
            }
          >
            {item.title}
          </Typography.Text>

          <Typography.Paragraph
            className={
              isDark
                ? '!mb-2 !mt-1 !text-xs !leading-relaxed !text-white/60'
                : '!mb-2 !mt-1 !text-xs !leading-relaxed !text-ink-500'
            }
          >
            {item.description}
          </Typography.Paragraph>

          <WorkflowModuleTags item={item} tone={tone} />
        </div>
      </div>
    </li>
  )
}

/**
 * @param {Object} props
 * @param {import('../../domain/systemWorkflow.js').SystemWorkflowStep} props.item
 * @param {'dark' | 'light'} props.tone
 */
function WorkflowModuleTags({ item, tone }) {
  const isDark = tone === 'dark'

  if (item.automatic) {
    return (
      <Tag
        bordered
        className={
          isDark
            ? '!m-0 !border-dashed !border-white/35 !bg-transparent !text-[11px] !text-white/70'
            : '!m-0 !border-dashed !border-ink-300 !bg-ink-50 !text-[11px] !text-ink-600'
        }
      >
        自动
      </Tag>
    )
  }

  if (!item.modules.length) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {item.modules.map((mod) => (
        <Tag
          key={mod.label}
          bordered={false}
          className={
            isDark
              ? '!m-0 !bg-white/10 !text-[11px] !text-white/75'
              : '!m-0 !bg-ink-100 !text-[11px] !text-ink-600'
          }
        >
          {mod.label}
        </Tag>
      ))}
    </div>
  )
}
