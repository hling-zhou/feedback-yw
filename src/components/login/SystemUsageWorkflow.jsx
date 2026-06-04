import { Tag, Typography } from 'antd'
import { SYSTEM_USAGE_WORKFLOW } from '../../domain/systemWorkflow.js'

/** @typedef {'full' | 'compact'} SystemUsageWorkflowVariant */

/**
 * @param {Object} props
 * @param {SystemUsageWorkflowVariant} [props.variant]
 * @param {string} [props.className]
 */
export default function SystemUsageWorkflow({ variant = 'full', className = '' }) {
  if (variant === 'compact') {
    return (
      <div className={className}>
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
      </div>
    )
  }

  return (
    <div className={className}>
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
    <li className="relative list-none pb-4 last:pb-0 lg:pb-5">
      {showConnector ? (
        <span
          className={
            isDark
              ? 'absolute left-[13px] top-8 bottom-0 w-px bg-brand-500/35'
              : 'absolute left-[13px] top-8 bottom-0 w-px bg-ink-200'
          }
          aria-hidden
        />
      ) : null}

      <div className="flex gap-3">
        <span
          className={
            isDark
              ? 'relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-400/60 bg-brand-600 text-xs font-semibold text-white shadow-soft'
              : 'relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-xs font-semibold text-brand-700'
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
            ? '!m-0 !border-dashed !border-brand-400/50 !bg-transparent !text-[11px] !text-brand-200'
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
              ? '!m-0 !bg-brand-600/30 !text-[11px] !text-brand-100'
              : '!m-0 !bg-ink-100 !text-[11px] !text-ink-600'
          }
        >
          {mod.label}
        </Tag>
      ))}
    </div>
  )
}
