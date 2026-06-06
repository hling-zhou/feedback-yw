import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Typography, Upload } from 'antd'
import { DeleteOutlined, InboxOutlined } from '@ant-design/icons'
import { useAppMessage } from '../hooks/useAppMessage.js'
import {
  MESSAGE_BOTTLE_ATTACHMENT_MAX,
  MESSAGE_BOTTLE_CONTENT_MAX,
  isMessageBottleImageFile,
  messageBottleAttachmentsTotalBytes,
  validateMessageBottleAttachments,
} from '../domain/messageBottle.js'
import { readMessageBottleAttachment, submitMessageBottle } from '../lib/messageBottleClient.js'

const { TextArea } = Input
const { Dragger } = Upload

/**
 * @param {{
 *   open: boolean
 *   onClose: () => void
 * }} props
 */
export default function MessageBottleSubmitModal({ open, onClose }) {
  const message = useAppMessage()
  const panelRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState(
    /** @type {import('../domain/messageBottle.js').MessageBottleAttachment[]} */ ([]),
  )
  const [submitting, setSubmitting] = useState(false)

  const reset = useCallback(() => {
    setContent('')
    setAttachments([])
  }, [])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const addFiles = useCallback(
    async (files) => {
      const imageFiles = [...files].filter(isMessageBottleImageFile)
      if (!imageFiles.length) {
        message.warning('请粘贴或上传图片截图')
        return
      }
      try {
        const loaded = await Promise.all(imageFiles.map(readMessageBottleAttachment))
        setAttachments((prev) => {
          const remaining = MESSAGE_BOTTLE_ATTACHMENT_MAX - prev.length
          if (remaining <= 0) {
            message.warning(`最多 ${MESSAGE_BOTTLE_ATTACHMENT_MAX} 张截图`)
            return prev
          }
          const merged = [...prev, ...loaded.slice(0, remaining)]
          const error = validateMessageBottleAttachments(merged)
          if (error) {
            message.warning(error)
            return prev
          }
          return merged
        })
      } catch (err) {
        message.error(err instanceof Error ? err.message : '读取截图失败')
      }
    },
    [message],
  )

  useEffect(() => {
    if (!open) return undefined
    const handlePaste = (event) => {
      const items = event.clipboardData?.items
      if (!items?.length) return
      const files = []
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (!files.length) return
      event.preventDefault()
      void addFiles(files)
    }
    const node = panelRef.current
    node?.addEventListener('paste', handlePaste)
    return () => node?.removeEventListener('paste', handlePaste)
  }, [open, addFiles])

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (!trimmed) {
      message.warning('请填写想法内容')
      return
    }
    const attachmentError = validateMessageBottleAttachments(attachments)
    if (attachmentError) {
      message.warning(attachmentError)
      return
    }
    setSubmitting(true)
    try {
      await submitMessageBottle({
        content: trimmed,
        attachments: attachments.length ? attachments : undefined,
      })
      message.success('装瓶成功！我们会及时「打捞」')
      onClose()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const totalBytes = messageBottleAttachmentsTotalBytes(attachments)

  return (
    <Modal
      title="装进漂流瓶"
      open={open}
      onCancel={onClose}
      destroyOnClose
      width={560}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="submit" type="primary" loading={submitting} onClick={() => void handleSubmit()}>
          装进漂流瓶
        </Button>,
      ]}
    >
      <div ref={panelRef} className="space-y-4">
        <div>
          <Typography.Text className="mb-2 block text-sm text-ink-700">你的想法</Typography.Text>
          <TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="发现 bug、体验问题或产品点子都可以写在这里…"
            autoSize={{ minRows: 5, maxRows: 10 }}
            maxLength={MESSAGE_BOTTLE_CONTENT_MAX}
            showCount
          />
        </div>

        <div>
          <Typography.Text className="mb-2 block text-sm text-ink-700">
            附件截图
            <Typography.Text type="secondary" className="ml-2 text-xs">
              Ctrl+V 粘贴或拖拽上传，最多 {MESSAGE_BOTTLE_ATTACHMENT_MAX} 张
            </Typography.Text>
          </Typography.Text>
          <Dragger
            multiple
            accept="image/*"
            showUploadList={false}
            beforeUpload={(file, fileList) => {
              void addFiles(fileList)
              return false
            }}
            className="!bg-ink-50/60"
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">拖拽截图到此处，或点击选择文件</p>
            <p className="ant-upload-hint">也支持在弹窗内 Ctrl+V 直接粘贴截图</p>
          </Dragger>

          {attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {attachments.map((item, index) => (
                <div key={`${item.fileName}-${index}`} className="relative">
                  <img
                    src={item.dataUrl}
                    alt={item.fileName}
                    className="h-20 w-20 rounded-lg border border-ink-200 object-cover"
                  />
                  <button
                    type="button"
                    className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border border-ink-200 bg-white text-ink-500 shadow-sm hover:text-red-500"
                    aria-label="移除截图"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <DeleteOutlined className="text-xs" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <Typography.Text type="secondary" className="mt-2 block text-xs">
              已选 {attachments.length} 张 · 约 {Math.max(1, Math.round(totalBytes / 1024))} KB
            </Typography.Text>
          )}
        </div>
      </div>
    </Modal>
  )
}
