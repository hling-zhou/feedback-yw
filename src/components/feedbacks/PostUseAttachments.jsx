import { useCallback, useEffect, useRef, useState } from 'react'
import { DeleteOutlined, DownloadOutlined, EyeOutlined, InboxOutlined } from '@ant-design/icons'
import { Button, Empty, Modal, Pagination, Popconfirm, Progress, Spin, Typography, message } from 'antd'
import {
  deletePostUseAttachment,
  fetchPostUseAttachment,
  listPostUseAttachments,
  uploadPostUseAttachment,
} from '../../lib/postUseAttachmentClient.js'

const PAGE_SIZE = 50
const ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.heic,.heif,.avif,.svg,.pdf,.doc,.docx,.xls,.xlsx,.csv'
const SUPPORTED = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|avif|svg|pdf|docx?|xlsx?|csv)$/i

function fileSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MB'
  return (bytes / 1024 ** 3).toFixed(1) + ' GB'
}

function uploadTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false })
}

/** @param {{ ownerType: 'trace' | 'visit', ownerId: string, open: boolean, canEdit: boolean }} props */
export default function PostUseAttachments({ ownerType, ownerId, open, canEdit }) {
  const fileInputRef = useRef(null)
  const queueRef = useRef([])
  const processingRef = useRef(false)
  const controllerRef = useRef(null)
  const mountedRef = useRef(false)
  const requestSeqRef = useRef(0)
  const previewUrlRef = useRef('')
  const nextTaskIdRef = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState([])
  const [deletingId, setDeletingId] = useState('')
  const [previewLoadingId, setPreviewLoadingId] = useState('')
  const [preview, setPreview] = useState(null)

  const loadPage = useCallback(async (nextPage) => {
    if (!ownerId || !open) return
    const seq = ++requestSeqRef.current
    setLoading(true)
    try {
      const result = await listPostUseAttachments(ownerType, ownerId, nextPage, PAGE_SIZE)
      if (seq !== requestSeqRef.current || !mountedRef.current) return
      setItems(result.items || [])
      setTotal(Number(result.total || 0))
      setPage(nextPage)
    } catch (error) {
      if (seq === requestSeqRef.current && mountedRef.current) {
        message.error(error?.message || '加载附件失败')
      }
    } finally {
      if (seq === requestSeqRef.current && mountedRef.current) setLoading(false)
    }
  }, [ownerType, ownerId, open])

  useEffect(() => {
    mountedRef.current = true
    setItems([])
    setTotal(0)
    setPage(1)
    if (open && ownerId) void loadPage(1)
    return () => {
      mountedRef.current = false
      requestSeqRef.current += 1
      queueRef.current = []
      controllerRef.current?.abort()
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = ''
    }
  }, [ownerType, ownerId, open, loadPage])

  const processQueue = async () => {
    if (processingRef.current) return
    processingRef.current = true
    try {
      while (queueRef.current.length && mountedRef.current) {
        const task = queueRef.current.shift()
        const controller = new AbortController()
        controllerRef.current = controller
        try {
          await uploadPostUseAttachment(ownerType, ownerId, task.file, (progress) => {
            if (mountedRef.current) {
              setPending((rows) => rows.map((row) => row.id === task.id ? { ...row, progress } : row))
            }
          }, controller.signal)
          if (mountedRef.current) {
            setPending((rows) => rows.filter((row) => row.id !== task.id))
            void loadPage(1)
          }
        } catch (error) {
          if (mountedRef.current && error?.name !== 'AbortError') {
            const text = error?.message || '上传失败'
            setPending((rows) => rows.map((row) => row.id === task.id
              ? { ...row, error: text } : row))
            message.error(task.file.name + '：' + text)
          }
        } finally {
          controllerRef.current = null
        }
      }
    } finally {
      processingRef.current = false
    }
  }

  /** @param {FileList | File[]} files */
  const enqueueFiles = (files) => {
    if (!canEdit) return
    const next = Array.from(files || [])
      .filter((file) => {
        if (SUPPORTED.test(file.name)) return true
        message.error(file.name + '：仅支持图片、PDF、Word、Excel、CSV 文件')
        return false
      })
      .map((file) => ({ id: ++nextTaskIdRef.current, file, progress: 0 }))
    if (!next.length) return
    queueRef.current.push(...next)
    setPending((rows) => [...rows, ...next.map(({ id, file, progress }) => ({ id, name: file.name, progress }))])
    void processQueue()
  }

  const handleDelete = async (item) => {
    setDeletingId(item.id)
    try {
      await deletePostUseAttachment(item.id)
      message.success('附件已删除')
      void loadPage(page > 1 && items.length === 1 ? page - 1 : page)
    } catch (error) {
      message.error(error?.message || '删除附件失败')
    } finally {
      setDeletingId('')
    }
  }

  const handleDownload = async (item) => {
    try {
      const blob = await fetchPostUseAttachment(item.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = item.filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      message.error(error?.message || '下载附件失败')
    }
  }

  const handlePreview = async (item) => {
    setPreviewLoadingId(item.id)
    try {
      const blob = await fetchPostUseAttachment(item.id, true)
      const url = URL.createObjectURL(blob)
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = url
      setPreview({ item, url })
    } catch (error) {
      message.error(error?.message || '预览附件失败')
    } finally {
      setPreviewLoadingId('')
    }
  }

  const closePreview = () => {
    setPreview(null)
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = ''
  }

  return (
    <section aria-label="附件" className="space-y-2">
      <div className="flex items-center justify-between">
        <Typography.Text type="secondary">附件（{total}）</Typography.Text>
      </div>
      {canEdit && (
        <div
          role="button"
          tabIndex={0}
          aria-label="选择或拖入附件上传"
          className={'cursor-pointer rounded-lg border border-dashed px-4 py-4 text-center transition-colors ' +
            (dragging ? 'border-blue-500 bg-blue-50' : 'border-ink-200 bg-ink-50 hover:border-blue-400')}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              fileInputRef.current?.click()
            }
          }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            enqueueFiles(event.dataTransfer.files)
          }}
        >
          <InboxOutlined className="mb-1 text-xl text-blue-500" aria-hidden="true" />
          <div className="text-sm">点击选择或直接拖入文件</div>
          <div className="mt-1 text-xs text-ink-500">图片、PDF、Word、Excel、CSV · 可多选</div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              enqueueFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>
      )}
      {pending.map((row) => (
        <div key={row.id} className="rounded-md border border-ink-100 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm" title={row.name}>{row.name}</span>
            {row.error && (
              <Button type="link" size="small" onClick={() => setPending((rows) => rows.filter((item) => item.id !== row.id))}>
                移除
              </Button>
            )}
          </div>
          {row.error
            ? <Typography.Text type="danger" className="text-xs">{row.error}</Typography.Text>
            : <Progress percent={row.progress} size="small" />}
        </div>
      ))}
      <Spin spinning={loading}>
        {items.length
          ? <div className="divide-y divide-ink-100 rounded-md border border-ink-100">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" title={item.filename}>{item.filename}</div>
                    <div className="text-xs text-ink-500">
                      {fileSize(item.sizeBytes)} · {item.uploadedByUsername || '—'} · {uploadTime(item.uploadedAt)}
                    </div>
                  </div>
                  {item.previewable && (
                    <Button
                      type="text" size="small" icon={<EyeOutlined />} aria-label={'预览' + item.filename}
                      loading={previewLoadingId === item.id}
                      onClick={() => void handlePreview(item)}
                    />
                  )}
                  <Button
                    type="text" size="small" icon={<DownloadOutlined />} aria-label={'下载' + item.filename}
                    onClick={() => void handleDownload(item)}
                  />
                  {canEdit && (
                    <Popconfirm
                      title="删除附件？"
                      description={item.filename}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void handleDelete(item)}
                    >
                      <Button
                        type="text" size="small" danger icon={<DeleteOutlined />}
                        aria-label={'删除' + item.filename} loading={deletingId === item.id}
                      />
                    </Popconfirm>
                  )}
                </div>
              ))}
            </div>
          : !loading && pending.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无附件" /> : null}
      </Spin>
      {total > PAGE_SIZE && (
        <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={total}
          showSizeChanger={false} onChange={(next) => void loadPage(next)} />
      )}
      <Modal title={preview?.item.filename} open={Boolean(preview)} footer={null}
        width={800} onCancel={closePreview} destroyOnHidden>
        {preview?.item.mimeType === 'application/pdf'
          ? <iframe title={preview.item.filename} src={preview.url} className="h-[70vh] w-full border-0" />
          : <img src={preview?.url || ''} alt={preview?.item.filename || ''} className="max-h-[70vh] max-w-full object-contain" />}
      </Modal>
    </section>
  )
}
