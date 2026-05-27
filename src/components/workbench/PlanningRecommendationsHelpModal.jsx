import { useMemo, useState } from 'react'
import { Button, Modal, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { buildPlanningRecommendationsHelpSections } from '../../lib/planningRecommendationTemplate.js'

/**
 * 行动建议区块「生成规则」说明（问号 → 弹窗）
 */
export default function PlanningRecommendationsHelpModal() {
  const [open, setOpen] = useState(false)
  const sections = useMemo(() => buildPlanningRecommendationsHelpSections(), [])

  return (
    <>
      <Button
        type="text"
        size="small"
        className="!h-6 !min-w-6 shrink-0 !px-1 !text-gray-400 hover:!text-indigo-600"
        aria-label="查看行动建议生成规则"
        icon={<QuestionCircleOutlined />}
        onClick={() => setOpen(true)}
      />
      <Modal
        title="行动建议生成规则"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={680}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" className="!mb-4 text-sm">
          以下规则与系统规则引擎一致；修改工单或标签后请刷新洞察以重新计算。
        </Typography.Paragraph>
        <div className="max-h-[min(70vh,520px)] space-y-5 overflow-y-auto pr-1">
          {sections.map((section) => (
            <section key={section.title}>
              <Typography.Title level={5} className="!mb-2 !text-sm !font-semibold">
                {section.title}
              </Typography.Title>
              {section.paragraphs?.map((p) => (
                <Typography.Paragraph key={p} className="!mb-2 text-sm leading-relaxed text-gray-700">
                  {p}
                </Typography.Paragraph>
              ))}
              {section.items?.length ? (
                <ul className="mb-0 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-gray-700">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </Modal>
    </>
  )
}
