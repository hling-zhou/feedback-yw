import { Card, Statistic, Typography } from 'antd'

export default function StatCard({ label, value, sub, accent }) {
  return (
    <Card>
      <Statistic
        title={label}
        value={value}
        styles={{
          content: {
            color: accent ? '#d97706' : '#0B0F19',
            fontSize: 24,
            fontWeight: 700,
          },
        }}
      />
      {sub && (
        <Typography.Text type="secondary" className="mt-1 block text-xs">
          {sub}
        </Typography.Text>
      )}
    </Card>
  )
}
