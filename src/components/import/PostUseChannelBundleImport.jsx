import { Alert, Card, Descriptions, Typography, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { MAX_IMPORT_FILES } from '../../lib/importBatchFiles.js'
import { displayImportFileName } from '../../lib/importFilePassword.js'

/**
 * @param {File} file
 * @param {string} prefix
 * @param {number} index
 */
function toUploadItem(file, prefix, index) {
  return {
    uid: `${prefix}-${index}-${file.name}-${file.size}-${file.lastModified}`,
    name: displayImportFileName(file.name),
    status: /** @type {const} */ ('done'),
  }
}

/**
 * 用后即评双渠道：上传步 / 预览确认步（状态由父级持有，避免切步丢文件）。
 * 短信与官网各支持 1～5 个文件。
 *
 * @param {{
 *   phase: 'upload' | 'preview'
 *   importBusy?: boolean
 *   smsFiles: File[]
 *   webFiles: File[]
 *   preview: object | null
 *   onAddSmsFile?: (file: File) => void
 *   onAddWebFile?: (file: File) => void
 *   onSmsFilesChange?: (files: File[]) => void
 *   onWebFilesChange?: (files: File[]) => void
 * }} props
 */
export default function PostUseChannelBundleImport({
  phase,
  importBusy = false,
  smsFiles = [],
  webFiles = [],
  preview,
  onAddSmsFile,
  onAddWebFile,
  onSmsFilesChange,
  onWebFilesChange,
}) {
  const smsNames = smsFiles.map((file) => displayImportFileName(file.name)).join('、') || '—'
  const webNames = webFiles.map((file) => displayImportFileName(file.name)).join('、') || '—'

  if (phase === 'preview') {
    return (
      <div className="space-y-4">
        <Alert
          type="info"
          showIcon
          title="请核对解析摘要后再确认导入"
          description={
            <>
              短信（{smsFiles.length}）：{smsNames} · 官网（{webFiles.length}）：{webNames}。确认导入后可离开本页，任务在后台继续，完成后将全局通知。
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
        title="请上传短信渠道与官网渠道原始文件"
        description={`短信渠道.xls（表头在第 3 行）与官网渠道.xls（含评分类 / 选项类 / 投诉处理-电话回访）各支持最多 ${MAX_IMPORT_FILES} 个文件，将按渠道合并解析。选好文件后进入「预览确认」核对条数与口径。加密文件可把密码写在文件名中，格式为 名称#密码.xlsx。`}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card size="small" title={`短信渠道.xls（${smsFiles.length}/${MAX_IMPORT_FILES}）`}>
          <Upload.Dragger
            accept=".xls,.xlsx"
            multiple
            maxCount={MAX_IMPORT_FILES}
            disabled={importBusy || smsFiles.length >= MAX_IMPORT_FILES}
            beforeUpload={(file) => {
              onAddSmsFile?.(file)
              return false
            }}
            onRemove={(item) => {
              onSmsFilesChange?.(smsFiles.filter((_, index) => toUploadItem(smsFiles[index], 'sms', index).uid !== item.uid))
            }}
            fileList={smsFiles.map((file, index) => toUploadItem(file, 'sms', index))}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽短信渠道文件（可多选）</p>
          </Upload.Dragger>
        </Card>
        <Card size="small" title={`官网渠道.xls（${webFiles.length}/${MAX_IMPORT_FILES}）`}>
          <Upload.Dragger
            accept=".xls,.xlsx"
            multiple
            maxCount={MAX_IMPORT_FILES}
            disabled={importBusy || webFiles.length >= MAX_IMPORT_FILES}
            beforeUpload={(file) => {
              onAddWebFile?.(file)
              return false
            }}
            onRemove={(item) => {
              onWebFilesChange?.(webFiles.filter((_, index) => toUploadItem(webFiles[index], 'web', index).uid !== item.uid))
            }}
            fileList={webFiles.map((file, index) => toUploadItem(file, 'web', index))}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽官网渠道文件（可多选）</p>
          </Upload.Dragger>
        </Card>
      </div>
    </div>
  )
}
