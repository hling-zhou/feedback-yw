import { useMemo, useState } from 'react'
import { Card, Select, Tag, Typography } from 'antd'
import SimpleList from './ui/SimpleList.jsx'
import { getJourneyReference, listJourneyTemplates } from '../lib/taxonomyLoader.js'

/**
 * @param {{ productOptions?: { label: string; value: string; taxonomyKey?: string }[] }} props
 */
export default function JourneyReference({ productOptions = [] }) {
  const templates = useMemo(() => listJourneyTemplates(), [])
  const [selectedKey, setSelectedKey] = useState('eip')

  const options = useMemo(() => {
    const fromTemplates = templates.map((t) => ({
      label: `${t.name}（${t.l1Count} 个一级 · ${t.l2Count} 个二级）`,
      value: t.key,
    }))
    const fromData = productOptions
      .filter((p) => p.taxonomyKey && !fromTemplates.some((t) => t.value === p.taxonomyKey))
      .map((p) => ({
        label: p.label,
        value: p.taxonomyKey,
      }))
    return [...fromTemplates, ...fromData]
  }, [templates, productOptions])

  const current = templates.find((t) => t.key === selectedKey) || templates[0]
  const journeys = getJourneyReference(selectedKey)

  return (
    <Card
      className="max-w-3xl"
      title="用户旅程标签参考"
      extra={
        <Select
          className="min-w-[240px]"
          value={selectedKey}
          options={options}
          onChange={setSelectedKey}
        />
      }
    >
      <Typography.Paragraph type="secondary" className="!mb-2 !text-xs">
        不同产品使用<strong>独立旅程模板</strong>打标；导入时按「产品规格」解析为目标产品后选用对应模板（见设置中的产品规格关系表）。
      </Typography.Paragraph>
      <Tag color="blue" className="mb-3">
        当前模板：{current?.name} · {current?.l1Count} 个一级环节
      </Tag>
      <div className="max-h-[480px] space-y-4 overflow-y-auto">
        {journeys.map((l1) => (
          <Card key={l1.id} size="small">
            <Typography.Text strong className="text-brand-700">
              {l1.label}
            </Typography.Text>
            {l1.description && (
              <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 !text-xs">
                {l1.description}
              </Typography.Paragraph>
            )}
            <SimpleList
              className="mt-2 border-l-2 border-brand-100 pl-3"
              size="small"
              dataSource={l1.children}
              renderItem={(l2) => (
                <div>
                  <Typography.Text className="text-xs" strong>
                    {l2.label}
                  </Typography.Text>
                  {l2.description && (
                    <Typography.Text type="secondary" className="mt-0.5 block text-xs">
                      {l2.description}
                    </Typography.Text>
                  )}
                </div>
              )}
            />
          </Card>
        ))}
      </div>
    </Card>
  )
}
