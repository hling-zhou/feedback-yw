import { Alert, Button, Checkbox, Input, Modal, Select, Space, Typography } from 'antd'
import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'
import { downloadQuoteComparisonCsv } from '../lib/quoteComparisonExport.js'
import {
  parseNoisePatternsFromTextarea,
  normalizeQuoteNoiseConfig,
} from '../lib/quoteNoise.js'
import {
  computeQuoteExtractionVersion,
  countStaleQuoteExtractions,
  normalizeQuoteExtractionConfig,
  patchQuoteExtractionConfig,
  quoteExtractionOptionsForSource,
  resolveQuoteExtractionMode,
} from '../lib/quoteExtraction.js'

const { TextArea } = Input

/** 重算任务说明（与 InsightsContext.reprocessAllCustomerQuotes 行为一致） */
export const QUOTE_REPROCESS_SCOPE_HINT =
  '仅重算当前洞察周期内已加载的反馈（切换周期后需在该周期下分别执行），不会扫描全库所有月份。'

export const QUOTE_REPROCESS_DURATION_HINT =
  '本地规则抽取，不调用大模型：重算本身很快；条数较多时主要耗时在分批写入服务器与刷新洞察快照。'

/**
 * @param {Object} props
 * @param {import('../lib/storage.js').AppSettings} props.settings
 * @param {(patch: Partial<import('../lib/storage.js').AppSettings>) => void} props.onTeamChange
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.reprocessing]
 * @param {(reportProgress?: (text: string) => void) => Promise<number | void>} [props.onReprocessAll]
 * @param {import('../lib/types.js').FeedbackRecord[]} [props.feedbacks]
 * @param {(msg: string) => void} [props.onMessage]
 */
export default function QuoteExtractionSettings({
  settings,
  onTeamChange,
  disabled = false,
  reprocessing = false,
  onReprocessAll,
  feedbacks = [],
  onMessage,
}) {
  const quoteExtraction = normalizeQuoteExtractionConfig(settings.quoteExtraction)
  const quoteNoise = normalizeQuoteNoiseConfig(settings.quoteNoise)
  const versionLabel = computeQuoteExtractionVersion(settings)
  const staleCount = countStaleQuoteExtractions(feedbacks, settings)

  const notify = (type, text) => {
    if (onMessage) onMessage(text)
    else if (type === 'success') console.info(text)
    else console.warn(text)
  }

  const handleExportComparison = () => {
    const ok = downloadQuoteComparisonCsv(feedbacks, settings, { staleOnly: true })
    if (ok) notify('success', '已导出过期原话对比 CSV')
    else notify('info', '没有需要对比的过期记录')
  }

  return (
    <Space orientation="vertical" size={12} className="w-full">
      <Typography.Text type="secondary" className="block text-xs">
        按数据来源配置客户原话抽取方式；工单类可叠加下方「模板正则兜底」。修改后请重算库内原话。
      </Typography.Text>
      <Typography.Text type="secondary" className="block text-xs font-mono">
        当前规则版本：{versionLabel}
      </Typography.Text>
      {staleCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`约 ${staleCount} 条反馈的客户原话与当前规则不一致`}
          description="可导出对比表核对差异，或点击下方按钮重算。"
          action={
            <Button size="small" disabled={disabled} onClick={handleExportComparison}>
              导出原话对比
            </Button>
          }
        />
      ) : null}

      {DATA_SOURCE_TYPES.map((source) => {
        const options = quoteExtractionOptionsForSource(source)
        const value = resolveQuoteExtractionMode(source, { ...settings, quoteExtraction })
        const locked = options.length === 1

        return (
          <div
            key={source}
            className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
          >
            <Typography.Text className="shrink-0 text-sm">
              {DATA_SOURCE_LABELS[source]}
            </Typography.Text>
            <Select
              className="min-w-[240px] sm:max-w-md"
              disabled={disabled || locked}
              value={value}
              options={options}
              onChange={(mode) =>
                onTeamChange({
                  quoteExtraction: patchQuoteExtractionConfig(quoteExtraction, source, mode),
                })
              }
            />
          </div>
        )
      })}

      <Checkbox
        checked={settings.useRegex}
        disabled={disabled}
        onChange={(e) => onTeamChange({ useRegex: e.target.checked })}
      >
        工单类在无【受理/咨询内容】时，用模板正则兜底
      </Checkbox>

      <div className="rounded-lg border border-ink-100 bg-ink-50/30 p-3">
        <Typography.Text strong className="text-xs">
          噪声剔除（团队共享）
        </Typography.Text>
        <Typography.Text type="secondary" className="mt-1 block text-xs">
          内置已含联系时间、问题原因等；下方为追加规则。每行一条：普通文本表示「行首匹配」；以{' '}
          <code className="text-xs">regex:</code> 开头表示正则。
        </Typography.Text>
        <div className="mt-3">
          <Typography.Text className="mb-1 block text-xs">追加整行剔除</Typography.Text>
          <TextArea
            disabled={disabled}
            rows={3}
            placeholder={'答复内容：\nregex:^\\s*处理结果[:：]'}
            value={quoteNoise.extraLinePatterns.join('\n')}
            onChange={(e) =>
              onTeamChange({
                quoteNoise: {
                  ...quoteNoise,
                  extraLinePatterns: parseNoisePatternsFromTextarea(e.target.value),
                },
              })
            }
          />
        </div>
        <div className="mt-3">
          <Typography.Text className="mb-1 block text-xs">
            追加行内截断标签（遇「标签：」后截断）
          </Typography.Text>
          <TextArea
            disabled={disabled}
            rows={2}
            placeholder={'答复内容\n目前进展'}
            value={quoteNoise.extraInlineLabels.join('\n')}
            onChange={(e) =>
              onTeamChange({
                quoteNoise: {
                  ...quoteNoise,
                  extraInlineLabels: parseNoisePatternsFromTextarea(e.target.value),
                },
              })
            }
          />
        </div>
      </div>

      <Typography.Text type="secondary" className="block text-xs">
        {QUOTE_REPROCESS_SCOPE_HINT}
        {QUOTE_REPROCESS_DURATION_HINT}
      </Typography.Text>

      <Space wrap>
        {onReprocessAll ? (
          <Button
            loading={reprocessing}
            disabled={disabled || reprocessing || !feedbacks.length}
            onClick={() => {
              const total = feedbacks.length
              Modal.confirm({
                title: '按当前规则重算客户原话？',
                width: 480,
                content: (
                  <div className="space-y-2 pt-1 text-sm">
                    <p>
                      将对<strong>当前洞察周期</strong>内已加载的 <strong>{total}</strong>{' '}
                      条反馈重算 <code>customerQuote</code> 与情绪，并写回共享库。
                    </p>
                    {staleCount > 0 ? (
                      <p className="text-amber-700">
                        其中约 <strong>{staleCount}</strong> 条原话版本与当前规则不一致。
                      </p>
                    ) : null}
                    <p className="text-xs text-ink-500">{QUOTE_REPROCESS_DURATION_HINT}</p>
                    <p className="text-xs text-ink-500">{QUOTE_REPROCESS_SCOPE_HINT}</p>
                  </div>
                ),
                okText: '开始重算',
                cancelText: '取消',
                onOk: () => onReprocessAll(),
              })
            }}
          >
            按当前规则重算全部客户原话
          </Button>
        ) : null}
        <Button disabled={disabled || !feedbacks.length} onClick={handleExportComparison}>
          导出原话对比（仅过期记录）
        </Button>
      </Space>
    </Space>
  )
}
