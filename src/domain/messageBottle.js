export const MESSAGE_BOTTLE_CONTENT_MAX = 1000
export const MESSAGE_BOTTLE_ATTACHMENT_MAX = 5
export const MESSAGE_BOTTLE_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024
export const MESSAGE_BOTTLE_DEFAULT_PROGRESS = '待处理'

/** @typedef {{ dataUrl: string; fileName: string; mimeType: string; size?: number }} MessageBottleAttachment */

/**
 * @param {File} file
 */
export function isMessageBottleImageFile(file) {
  return Boolean(file?.type?.startsWith('image/'))
}

/**
 * @param {MessageBottleAttachment[]} attachments
 */
export function messageBottleAttachmentsTotalBytes(attachments) {
  return (attachments || []).reduce((sum, item) => sum + (item.size || estimateDataUrlBytes(item.dataUrl)), 0)
}

/**
 * @param {string} dataUrl
 */
function estimateDataUrlBytes(dataUrl) {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  return Math.ceil((base64?.length || 0) * 0.75)
}

/**
 * @param {MessageBottleAttachment[]} attachments
 * @returns {string | null}
 */
export function validateMessageBottleAttachments(attachments) {
  const list = attachments || []
  if (list.length > MESSAGE_BOTTLE_ATTACHMENT_MAX) {
    return `最多上传 ${MESSAGE_BOTTLE_ATTACHMENT_MAX} 张截图`
  }
  for (const item of list) {
    if (!item?.mimeType?.startsWith('image/')) return '仅支持图片附件'
    if (!item.dataUrl?.startsWith('data:image/')) return '附件格式无效'
  }
  const total = messageBottleAttachmentsTotalBytes(list)
  if (total > MESSAGE_BOTTLE_ATTACHMENT_MAX_BYTES) {
    return `附件总大小不能超过 ${Math.round(MESSAGE_BOTTLE_ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB`
  }
  return null
}
