import { Card, Space, Tag, Typography } from 'antd'
import { ApiOutlined } from '@ant-design/icons'

const { Title, Paragraph, Text } = Typography

/**
 * 产品重点 API 巡检 · 异常接口溯源（占位页，功能建设中）。
 * 正式功能开发前的路由与导航入口占位，避免落入 * 通配路由被重定向回工作台。
 */
export default function ApiPatrolFailures() {
  return (
    <div className="p-6">
      <Card>
        <Space direction="vertical" size={12}>
          <Space size={8}>
            <ApiOutlined className="text-brand-600" />
            <Title level={4} className="!m-0">
              API 巡检 · 异常接口溯源
            </Title>
            <Tag color="gold">功能建设中</Tag>
          </Space>
          <Paragraph type="secondary" className="!mb-0">
            异常接口溯源：按接口/产品/时间维度下钻异常工单，关联客户反馈原文与处理过程，定位异常根因。
          </Paragraph>
          <Text type="secondary" className="text-xs">
            新能力建设中，敬请期待。
          </Text>
        </Space>
      </Card>
    </div>
  )
}
