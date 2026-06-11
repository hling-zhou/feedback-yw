import { useCallback, useRef, useState } from 'react'
import { confirmDiscardFeedbackDrawerEdits } from '../lib/feedbackDrawerLeaveConfirm.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * 工单详情抽屉：选中态 + 未保存离开确认（遮罩关闭 / 切换工单）。
 *
 * @param {FeedbackRecord | null} [initialSelected]
 */
export function useFeedbackDrawerSelection(initialSelected = null) {
  const [selected, setSelected] = useState(initialSelected)
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const drawerDirtyRef = useRef(false)

  const onDrawerDirtyChange = useCallback((dirty) => {
    drawerDirtyRef.current = dirty
  }, [])

  const closeDrawer = useCallback(() => {
    drawerDirtyRef.current = false
    setSelected(null)
  }, [])

  const requestCloseDrawer = useCallback(() => {
    if (!drawerDirtyRef.current) {
      closeDrawer()
      return
    }
    confirmDiscardFeedbackDrawerEdits(closeDrawer)
  }, [closeDrawer])

  const selectFeedback = useCallback((next) => {
    const current = selectedRef.current

    if (!next) {
      if (drawerDirtyRef.current && current) {
        confirmDiscardFeedbackDrawerEdits(closeDrawer)
        return
      }
      setSelected(null)
      return
    }

    if (!current || current.id === next.id) {
      setSelected(next)
      return
    }

    if (drawerDirtyRef.current) {
      confirmDiscardFeedbackDrawerEdits(() => {
        drawerDirtyRef.current = false
        setSelected(next)
      })
      return
    }

    setSelected(next)
  }, [closeDrawer])

  /** 跳过未保存确认（周期切换、URL 深链等） */
  const setSelectedDirect = useCallback((next) => {
    drawerDirtyRef.current = false
    setSelected(next)
  }, [])

  return {
    selected,
    selectFeedback,
    setSelectedDirect,
    requestCloseDrawer,
    /** 保存成功等场景：跳过未保存确认直接关闭 */
    closeDrawer,
    onDrawerDirtyChange,
  }
}
