import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Button,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons'
import {
  listAssistantThreads,
  createAssistantThread,
  listAssistantMessages,
  deleteAssistantThread,
  sendAssistantChat,
} from '../lib/assistantClient.js'
import {
  buildAssistantLinkHref,
  buildAssistantCitationHref,
} from '../lib/assistantLinkBuilder.js'
import { trackUsage } from '../hooks/useUsageTracking.js'

const { Text, Paragraph } = Typography

const EXAMPLE_QUESTIONS = [
  '本月投诉主要痛点是什么？',
  '和上月比咨询量怎样？',
  '找出提到超时的工单',
  '当前有哪些进行中的产品举措？',
]

/**
 * @param {{ open: boolean; onClose: () => void; currentPeriodId: string }} props
 */
export default function AssistantDrawer({ open, onClose, currentPeriodId }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [threads, setThreads] = useState([])
  const [currentThreadId, setCurrentThreadId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingThreads, setLoadingThreads] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)

  const pageContext = useMemo(() => {
    const query = {}
    for (const [k, v] of new URLSearchParams(location.search)) {
      if (k === 'tab' || k === 'source' || k === 'product') query[k] = v
    }
    return { pathname: location.pathname, query }
  }, [location.pathname, location.search])

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true)
    try {
      const { threads: list } = await listAssistantThreads()
      setThreads(list)
      if (list.length && !currentThreadId) {
        setCurrentThreadId(list[0].id)
      } else if (!list.length) {
        setCurrentThreadId(null)
        setMessages([])
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : '加载会话失败')
    } finally {
      setLoadingThreads(false)
    }
  }, [currentThreadId])

  const loadMessages = useCallback(async (threadId) => {
    if (!threadId) {
      setMessages([])
      return
    }
    try {
      const { messages: list } = await listAssistantMessages(threadId)
      setMessages(list)
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : '加载消息失败')
    }
  }, [])

  useEffect(() => {
    if (open) {
      trackUsage('assistant', { action: 'open' })
      void loadThreads()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open && currentThreadId) void loadMessages(currentThreadId)
    if (open && !currentThreadId) setMessages([])
  }, [open, currentThreadId, loadMessages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const handleNewThread = useCallback(async () => {
    try {
      const { thread } = await createAssistantThread({ title: '新对话' })
      setThreads((prev) => [thread, ...prev])
      setCurrentThreadId(thread.id)
      setMessages([])
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : '新建会话失败')
    }
  }, [])

  const handleDeleteThread = useCallback(async () => {
    if (!currentThreadId) return
    try {
      await deleteAssistantThread(currentThreadId)
      setThreads((prev) => prev.filter((t) => t.id !== currentThreadId))
      setCurrentThreadId(null)
      setMessages([])
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : '删除会话失败')
    }
  }, [currentThreadId])

  const handleSend = useCallback(
    async (questionText) => {
      const question = String(questionText ?? '').trim()
      if (!question || loading) return
      setInput('')
      setError('')
      // 乐观追加用户消息
      const tempUserMsg = {
        id: `temp-${Date.now()}`,
        role: 'user',
        payload: { question, insightPeriodId: currentPeriodId },
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, tempUserMsg])
      setLoading(true)
      try {
        let threadId = currentThreadId
        if (!threadId) {
          const { thread } = await createAssistantThread({ title: question })
          threadId = thread.id
          setThreads((prev) => [thread, ...prev])
          setCurrentThreadId(threadId)
        }
        const { message: assistantMessage } = await sendAssistantChat({
          threadId,
          question,
          insightPeriodId: currentPeriodId,
          pageContext,
        })
        setMessages((prev) => [...prev, assistantMessage])
      } catch (err) {
        const hint = err && typeof err === 'object' && 'data' in err ? err.data?.hint : ''
        const msg = err instanceof Error ? err.message : '查询失败'
        const full = hint ? `${msg}。${hint}` : msg
        setError(full)
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id))
        antdMessage.error(full)
      } finally {
        setLoading(false)
      }
    },
    [currentThreadId, currentPeriodId, pageContext, loading],
  )

  const handleOpenLink = useCallback(
    (link) => {
      const href = buildAssistantLinkHref(link)
      if (href) navigate(href)
    },
    [navigate],
  )

  const handleOpenCitation = useCallback(
    (citation) => {
      const href = buildAssistantCitationHref(citation)
      if (href) navigate(href)
    },
    [navigate],
  )

  const threadOptions = useMemo(
    () =>
      threads.map((t) => ({
        value: t.id,
        label: t.title || '新对话',
      })),
    [threads],
  )

  return (
    <Drawer
      title={
        <Space>
          <RobotOutlined />
          <span>AI 助手</span>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={420}
      placement="right"
      mask={false}
      styles={{ body: { padding: 0 } }}
    >
      <div className="flex flex-col h-full">
        {/* 会话切换栏 */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-100">
          <Select
            size="small"
            className="flex-1 min-w-0"
            value={currentThreadId || undefined}
            placeholder="选择会话"
            options={threadOptions}
            loading={loadingThreads}
            onChange={(id) => setCurrentThreadId(id)}
            notFoundContent="暂无会话"
          />
          <Tooltip title="新对话">
            <Button size="small" icon={<PlusOutlined />} onClick={handleNewThread} />
          </Tooltip>
          <Tooltip title="删除当前会话">
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={handleDeleteThread}
              disabled={!currentThreadId}
            />
          </Tooltip>
        </div>

        {/* 消息区 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {!messages.length && !loading && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="text-ink-400 text-sm">问点什么吧</span>
              }
            >
              <div className="flex flex-col gap-2 mt-3">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <Button
                    key={q}
                    size="small"
                    className="text-left"
                    onClick={() => handleSend(q)}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            </Empty>
          )}

          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onOpenLink={handleOpenLink}
              onOpenCitation={handleOpenCitation}
            />
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-ink-400 text-sm">
              <Spin size="small" />
              <span>正在查询平台数据…</span>
            </div>
          )}

          {error && (
            <div className="text-red-500 text-xs px-2 py-1">{error}</div>
          )}
        </div>

        {/* 输入区 */}
        <div className="border-t border-ink-100 px-3 py-2">
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="基于平台数据提问…"
            disabled={loading}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault()
                void handleSend(input)
              }
            }}
          />
          <div className="flex justify-end mt-2">
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              loading={loading}
              disabled={!input.trim()}
              onClick={() => handleSend(input)}
            >
              发送
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  )
}

/**
 * @param {{
 *   message: { role: 'user' | 'assistant'; payload: Record<string, unknown> }
 *   onOpenLink: (link: { kind: string; params: Record<string, string> }) => void
 *   onOpenCitation: (citation: { ticketId?: string; dataSourceType?: string }) => void
 * }} props
 */
function MessageBubble({ message, onOpenLink, onOpenCitation }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-indigo-50 text-ink-800 rounded-lg px-3 py-2 max-w-[85%] text-sm">
          {String(message.payload?.question || '')}
        </div>
      </div>
    )
  }

  const answer = String(message.payload?.answer || '')
  const citations = Array.isArray(message.payload?.citations)
    ? message.payload.citations
    : []
  const links = Array.isArray(message.payload?.links) ? message.payload.links : []

  return (
    <div className="flex justify-start">
      <div className="bg-white border border-ink-100 rounded-lg px-3 py-2 max-w-[90%] text-sm space-y-2">
        <Paragraph className="!mb-0 whitespace-pre-wrap">{answer}</Paragraph>

        {citations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {citations.map((c, i) => (
              <Tag
                key={c.recordId || i}
                className="cursor-pointer"
                color="blue"
                onClick={() => onOpenCitation(c)}
              >
                {c.ticketId || c.field || '原文'}
              </Tag>
            ))}
          </div>
        )}

        {links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {links.map((link, i) => {
              const label = linkLabel(link)
              return (
                <Button
                  key={i}
                  size="small"
                  type="link"
                  className="!px-1"
                  onClick={() => onOpenLink(link)}
                >
                  {label}
                </Button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * @param {{ kind: string; params: Record<string, string> }} link
 * @returns {string}
 */
function linkLabel(link) {
  if (link.kind === 'workbench') return `打开工作台${link.params?.tab ? `·${link.params.tab}` : ''}`
  if (link.kind === 'analysis') return '打开维度分析'
  if (link.kind === 'feedbacks') return '打开反馈库'
  if (link.kind === 'actions') return `打开举措·${link.params?.tab || ''}`
  return '打开'
}
