import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import PdfCaptureScopeView from './PdfCaptureScopeView.jsx'

/** @typedef {import('../../domain/pdfExportJob.js').PdfExportJobPayload} PdfExportJobPayload */

/**
 * @param {Object} props
 * @param {{ id: string; scope: PdfExportJobPayload['scope']; payload: PdfExportJobPayload } | null} props.captureJob
 * @param {(jobId: string) => void} props.onMounted
 */
export default function PdfCaptureHost({ captureJob, onMounted }) {
  useEffect(() => {
    if (!captureJob) return undefined
    let cancelled = false
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let mountTimer
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        mountTimer = setTimeout(() => {
          if (!cancelled) onMounted(captureJob.id)
        }, 80)
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (mountTimer) clearTimeout(mountTimer)
    }
  }, [captureJob, onMounted])

  if (!captureJob || typeof document === 'undefined') return null

  const tabKey = captureJob.scope === 'overview' ? 'overview' : captureJob.scope

  return createPortal(
    <div
      id="pdf-capture-root"
      aria-hidden="true"
      className="bg-white"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 1280,
        opacity: 0,
        pointerEvents: 'none',
        zIndex: -1,
        overflow: 'visible',
      }}
    >
      <div data-workbench-tab={tabKey} data-pdf-capture-scope={captureJob.scope}>
        <PdfCaptureScopeView scope={captureJob.scope} payload={captureJob.payload} />
      </div>
    </div>,
    document.body,
  )
}
