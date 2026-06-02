import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import { App } from 'antd'
import {
  createPdfExportJob,
  patchPdfExportJob,
  pdfExportScopeLabel,
} from '../domain/pdfExportJob.js'
import { runPdfExportJob } from '../lib/report/runPdfExportJob.js'
import { buildWanTouByProducts } from '../lib/wanTouRatio.js'
import { resolveSnapshotRecords } from '../snapshots/recordScope.js'
import PdfCaptureHost from '../components/report/PdfCaptureHost.jsx'
import { useInsights } from './InsightsContext.jsx'
import { isApiStorageAdapter } from '../storage/feedbackStore.js'
import {
  isBackgroundTaskConflictError,
  readBackgroundTaskErrorMessage,
} from '../lib/backgroundTaskClient.js'

/** @typedef {import('../domain/pdfExportJob.js').PdfExportJob} PdfExportJob */
/** @typedef {import('../domain/pdfExportJob.js').PdfExportJobPayload} PdfExportJobPayload */
/** @typedef {import('../domain/pdfExportJob.js').PdfExportScope} PdfExportScope */

/** @typedef {Object} EnqueuePdfExportInput
 * @property {PdfExportScope} scope
 * @property {import('../domain/insightPeriod.js').InsightPeriod | null} period
 * @property {import('../domain/snapshot.js').OverviewSnapshot | null} [overview]
 * @property {Partial<Record<import('../domain/enums.js').DataSourceType, import('../domain/snapshot.js').InsightSnapshot>>} [sourceSnapshots]
 * @property {import('../lib/types.js').FeedbackRecord[]} feedbacks
 * @property {import('../storage/orderVolumeStore.js').OrderVolumeRow[]} [orderVolumes]
 */

const PdfExportContext = createContext(null)

const CAPTURE_MOUNT_TIMEOUT_MS = 45000

/**
 * @param {PdfExportJob} job
 * @param {import('antd/es/notification/interface').NotificationInstance} notification
 */
function pushJobNotification(job, notification) {
  const isTerminal = job.status === 'done' || job.status === 'failed'
  notification.open({
    key: job.id,
    message: job.label,
    description: job.message,
    duration: isTerminal ? (job.status === 'done' ? 6 : 8) : 0,
    placement: 'bottomRight',
    type: job.status === 'failed' ? 'error' : job.status === 'done' ? 'success' : 'info',
  })
}

/**
 * @param {Object} props
 * @param {import('react').ReactNode} props.children
 */
export function PdfExportProvider({ children }) {
  const { message, notification } = App.useApp()
  const {
    adapter,
    prepareSharedBackgroundTask,
    touchSharedBackgroundTask,
    releaseSharedBackgroundTask,
  } = useInsights()
  const [tasks, setTasks] = useState(/** @type {PdfExportJob[]} */ ([]))
  const [captureJob, setCaptureJob] = useState(
    /** @type {{ id: string; scope: PdfExportScope; payload: PdfExportJobPayload } | null} */ (null),
  )

  const tasksRef = useRef(tasks)
  const processingRef = useRef(false)
  const lockTouchThrottleRef = useRef(0)
  /** @type {import('react').MutableRefObject<Set<string>>} */
  const captureMountedIdsRef = useRef(new Set())
  /** @type {import('react').MutableRefObject<Map<string, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>>} */
  const captureWaitersRef = useRef(new Map())

  tasksRef.current = tasks

  const touchExportLockProgress = useCallback(
    (progressMessage) => {
      if (!isApiStorageAdapter(adapter)) return
      const now = Date.now()
      if (now - lockTouchThrottleRef.current < 700) return
      lockTouchThrottleRef.current = now
      void touchSharedBackgroundTask({ progress: progressMessage })
    },
    [adapter, touchSharedBackgroundTask],
  )

  const patchJob = useCallback(
    (jobId, patch) => {
      setTasks((prev) => {
        const current = prev.find((item) => item.id === jobId)
        if (!current) return prev
        const next = patchPdfExportJob(current, patch)
        pushJobNotification(next, notification)
        return prev.map((item) => (item.id === jobId ? next : item))
      })
    },
    [notification],
  )

  const waitForCaptureMount = useCallback((jobId) => {
    if (captureMountedIdsRef.current.has(jobId)) {
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        captureWaitersRef.current.delete(jobId)
        reject(new Error('离屏图表渲染超时，请稍后重试'))
      }, CAPTURE_MOUNT_TIMEOUT_MS)

      captureWaitersRef.current.set(jobId, {
        resolve: () => {
          clearTimeout(timer)
          captureWaitersRef.current.delete(jobId)
          resolve()
        },
        reject: (err) => {
          clearTimeout(timer)
          captureWaitersRef.current.delete(jobId)
          reject(err)
        },
        timer,
      })
    })
  }, [])

  const handleCaptureMounted = useCallback((jobId) => {
    captureMountedIdsRef.current.add(jobId)
    captureWaitersRef.current.get(jobId)?.resolve()
  }, [])

  const waitForCaptureRoot = useCallback(
    async (jobId) => {
      await waitForCaptureMount(jobId)
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const root = document.getElementById('pdf-capture-root')
        if (root instanceof HTMLElement) {
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          return root
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      throw new Error('离屏导出容器未就绪')
    },
    [waitForCaptureMount],
  )

  const processQueue = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true

    try {
      while (true) {
        const next = tasksRef.current.find((task) => task.status === 'queued')
        if (!next) break

        patchJob(next.id, { status: 'preparing', message: '准备离屏渲染…' })

        captureMountedIdsRef.current.delete(next.id)
        flushSync(() => {
          setCaptureJob({
            id: next.id,
            scope: next.scope,
            payload: next.payload,
          })
        })

        let shouldReleaseLock = false
        let captureRoot = null
        try {
          captureRoot = await waitForCaptureRoot(next.id)

          if (isApiStorageAdapter(adapter)) {
            try {
              await prepareSharedBackgroundTask('pdf_export', {
                progress: '准备导出…',
                meta: {
                  scope: next.scope,
                  label: next.label,
                  periodLabel: next.payload.period?.label,
                },
              })
              shouldReleaseLock = true
            } catch (err) {
              if (isBackgroundTaskConflictError(err)) {
                throw new Error(readBackgroundTaskErrorMessage(err))
              }
              throw err
            }
          }

          await runPdfExportJob(next, {
            getCaptureRoot: async () => captureRoot,
            onProgress: ({ status, message: progressMessage, chartCount }) => {
              touchExportLockProgress(progressMessage)
              patchJob(next.id, {
                status: status || next.status,
                message: progressMessage,
                ...(chartCount != null ? { chartCount } : {}),
                ...(status === 'done' || status === 'failed'
                  ? { finishedAt: new Date().toISOString() }
                  : {}),
              })
            },
          })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'PDF 导出失败'
          patchJob(next.id, {
            status: 'failed',
            message: errorMessage,
            error: errorMessage,
            finishedAt: new Date().toISOString(),
          })
          console.error('[pdf-export]', err)
        } finally {
          captureMountedIdsRef.current.delete(next.id)
          setCaptureJob(null)
          if (shouldReleaseLock) {
            await releaseSharedBackgroundTask()
          }
          await new Promise((r) => setTimeout(r, 0))
        }
      }
    } finally {
      processingRef.current = false
    }
  }, [
    adapter,
    patchJob,
    prepareSharedBackgroundTask,
    releaseSharedBackgroundTask,
    touchExportLockProgress,
    waitForCaptureRoot,
  ])

  const enqueuePdfExport = useCallback(
    (input) => {
      const complaintRecords = resolveSnapshotRecords(
        input.feedbacks,
        input.sourceSnapshots?.complaint_ticket,
      )
      const wanTouRows =
        input.scope === 'overview'
          ? buildWanTouByProducts({
              period: input.period,
              records: complaintRecords,
              orderVolumes: input.orderVolumes || [],
              productList: input.sourceSnapshots?.complaint_ticket?.aggregates?.products,
            })
          : []

      /** @type {PdfExportJobPayload} */
      const payload = {
        scope: input.scope,
        period: input.period,
        overview: input.overview ?? null,
        sourceSnapshot:
          input.scope === 'overview' ? null : input.sourceSnapshots?.[input.scope] ?? null,
        sourceSnapshots: input.sourceSnapshots || {},
        feedbacks: input.feedbacks,
        orderVolumes: input.orderVolumes || [],
        wanTouRows,
        complaintRecords,
        exportedBy: '本地用户',
      }

      const job = createPdfExportJob(payload)
      setTasks((prev) => [...prev, job])
      pushJobNotification(job, notification)
      message.info(`「${pdfExportScopeLabel(input.scope)}」已加入导出队列，完成后将自动下载`, 4)
      return job.id
    },
    [message, notification],
  )

  useEffect(() => {
    if (tasks.some((task) => task.status === 'queued')) {
      void processQueue()
    }
  }, [tasks, processQueue])

  useEffect(() => {
    const running = tasks.some(
      (task) =>
        task.status === 'preparing' ||
        task.status === 'capturing' ||
        task.status === 'generating',
    )
    if (!running) return undefined

    const handler = (event) => {
      event.preventDefault()
      event.returnValue = 'PDF 导出进行中，离开页面将中断任务'
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [tasks])

  const activeTaskCount = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status === 'queued' ||
          task.status === 'preparing' ||
          task.status === 'capturing' ||
          task.status === 'generating',
      ).length,
    [tasks],
  )

  const value = useMemo(
    () => ({
      enqueuePdfExport,
      tasks,
      activeTaskCount,
    }),
    [enqueuePdfExport, tasks, activeTaskCount],
  )

  return (
    <PdfExportContext.Provider value={value}>
      {children}
      <PdfCaptureHost captureJob={captureJob} onMounted={handleCaptureMounted} />
    </PdfExportContext.Provider>
  )
}

export function usePdfExport() {
  const ctx = useContext(PdfExportContext)
  if (!ctx) {
    throw new Error('usePdfExport must be used within PdfExportProvider')
  }
  return ctx
}
