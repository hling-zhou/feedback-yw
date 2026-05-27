import { Button, Card, Input, Space, Typography } from 'antd'
import { DEFAULT_THEME_RULES, parseKeywords } from '../lib/themes.js'

/**
 * @param {{
 *   rules: import('../lib/themes.js').ThemeRule[];
 *   onChange: (rules: import('../lib/themes.js').ThemeRule[]) => void;
 *   onReprocess?: () => void;
 *   reprocessing?: boolean;
 * }} props
 */
export default function ThemeRulesEditor({ rules, onChange, onReprocess, reprocessing }) {
  const updateRule = (id, patch) => {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const addRule = () => {
    const id = `custom-${Date.now()}`
    onChange([
      ...rules,
      { id, label: '新主题', description: '', keywords: [] },
    ])
  }

  const removeRule = (id) => {
    if (!confirm('确定删除该主题规则？')) return
    onChange(rules.filter((r) => r.id !== id))
  }

  const resetDefaults = () => {
    if (!confirm('恢复为系统默认主题规则？自定义规则将被覆盖。')) return
    onChange([...DEFAULT_THEME_RULES])
  }

  return (
    <div className="space-y-4">
      <Typography.Paragraph type="secondary" className="!mb-0 !text-xs">
        每条主题包含<strong>名称</strong>、<strong>解释</strong>（语义匹配的核心）和<strong>参考关键词</strong>。
        在「设置」中选择<strong>语义匹配 (LLM)</strong> 且服务端已配置 LLM_API_KEY 后，将按解释理解反馈含义；否则使用「解释+关键词」本地智能匹配。
      </Typography.Paragraph>

      <div className="space-y-3">
        {rules.map((rule) => (
          <Card key={rule.id} size="small" className="bg-ink-50/50">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-[140px] flex-1">
                <Typography.Text strong className="mb-1 block text-xs">主题名称</Typography.Text>
                <Input
                  value={rule.label}
                  onChange={(e) => updateRule(rule.id, { label: e.target.value })}
                />
              </div>
              <Button
                className="mt-5"
                type="link"
                danger
                size="small"
                onClick={() => removeRule(rule.id)}
              >
                删除
              </Button>
            </div>
            <div className="mt-3">
              <Typography.Text strong className="mb-1 block text-xs">主题解释（用于语义匹配）</Typography.Text>
              <Input.TextArea
                rows={3}
                placeholder="描述该主题涵盖哪类用户问题、场景和意图，例如：网络波动、断连、带宽异常等连通性问题"
                value={rule.description || ''}
                onChange={(e) => updateRule(rule.id, { description: e.target.value })}
              />
            </div>
            <div className="mt-3">
              <Typography.Text strong className="mb-1 block text-xs">参考关键词（逗号分隔，辅助匹配）</Typography.Text>
              <Input
                placeholder="网络, 波动, 断网"
                value={(rule.keywords || []).join(', ')}
                onChange={(e) =>
                  updateRule(rule.id, { keywords: parseKeywords(e.target.value) })
                }
              />
            </div>
          </Card>
        ))}
      </div>

      <Space wrap>
        <Button onClick={addRule}>
          + 添加主题
        </Button>
        <Button onClick={resetDefaults}>
          恢复默认
        </Button>
        {onReprocess && (
          <Button
            type="primary"
            loading={reprocessing}
            onClick={onReprocess}
          >
            用新规则重新分析全部
          </Button>
        )}
      </Space>
    </div>
  )
}
