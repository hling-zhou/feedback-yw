import { Alert, Card, Descriptions, Typography, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'

/**
 * 用后即评双文件：上传步 / 预览确认步（状态由父级持有，避免切步丢文件）。
 *
 * @param {{
 *   phase: 'upload' | 'preview'
 *   importBusy?: boolean
 *   smsFile: File | null
 *   webFile: File | null
 *   preview: object | null
 *   onSmsFileChange?: (file: File | null) => void
 *   onWebFileChange?: (file: File | null) => void
 * }} props
 */
export default function PostUseChannelBundleImport({
  phase,
  importBusy = false,
  smsFile,
  webFile,
  preview,
  onSmsFileChange,
  onWebFileChange,
}) {
  if (phase === 'preview') {
    return (
      <div className="space-y-4">
        <Alert
          type="info"
          showIcon
          title="请核对解析摘要后再确认导入"
          description={
            <>
              短信：{smsFile?.name || '—'} · 官网：{webFile?.name || '—'}。确认导入后可离开本页，任务在后台继续，完成后将全局通知。
            </>
          }
        />
        {preview ? (
          <Card size="small" title="预览摘要">
            <Descriptions column={2} size="small">
              <Descriptions.Item label="短信有效">{preview.merged.counts.sms}</Descriptions.Item>
              <Descriptions.Item label="控制台评分">{preview.merged.counts.console}</Descriptions.Item>
              <Descriptions.Item label="投诉回访">{preview.merged.counts.callback}</Descriptions.Item>
              <Descriptions.Item label="去重后合计">{preview.merged.counts.scoredMerged}</Descriptions.Item>
              <Descriptions.Item label="对内体验均分">
                {preview.metrics.internalExp.avgScore}（n=
                {preview.metrics.internalExp.totalSample}）
              </Descriptions.Item>
              <Descriptions.Item label="对外云网均分">
                {preview.metrics.external.yunwang.avgScore}（n=
                {preview.metrics.external.yunwang.totalSample}）
              </Descriptions.Item>
            </Descriptions>
            <Typography.Text type="secondary" className="text-xs">
              对内体验分=短信+控制台；对外月报口径仍为三渠道混算。投诉回访满意度单独统计。
            </Typography.Text>
          </Card>
        ) : (
          <Alert type="warning" showIcon title="尚未解析预览，请返回上一步重新解析" />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Alert
        type="info"
        showIcon
        title="请上传两份原始数据源"
        description="短信渠道.xls（表头在第 3 行）+ 官网渠道.xls（含评分类 / 选项类 / 投诉处理-电话回访）。选好文件后进入「预览确认」核对条数与口径。"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card size="small" title="短信渠道.xls">
          <Upload.Dragger
            accept=".xls,.xlsx"
            maxCount={1}
            disabled={importBusy}
            beforeUpload={(file) => {
              onSmsFileChange?.(file)
              return false
            }}
            onRemove={() => onSmsFileChange?.(null)}
            fileList={smsFile ? [{ uid: 'sms', name: smsFile.name, status: 'done' }] : []}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽短信渠道文件</p>
          </Upload.Dragger>
        </Card>
        <Card size="small" title="官网渠道.xls">
          <Upload.Dragger
            accept=".xls,.xlsx"
            maxCount={1}
            disabled={importBusy}
            beforeUpload={(file) => {
              onWebFileChange?.(file)
              return false
            }}
            onRemove={() => onWebFileChange?.(null)}
            fileList={webFile ? [{ uid: 'web', name: webFile.name, status: 'done' }] : []}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽官网渠道文件</p>
          </Upload.Dragger>
        </Card>
      </div>
    </div>
  )
}
