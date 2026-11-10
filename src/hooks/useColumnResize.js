import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyColumnWidths,
  clampColumnWidth,
  clearColumnWidths,
  columnIdentityKey,
  isResizableColumn,
  loadColumnWidths,
  saveColumnWidths,
} from '../lib/columnWidths.js'

/** 拖拽手柄命中区宽度（表头单元格右侧 N px，与 CSS ::after 手柄一致） */
export const RESIZER_HIT_ZONE = 8

/**
 * 表格列宽拖拽 hook（2026-11-10 方案 v2）。
 *
 * 契约（父层持有、子层消费）：
 * - 页面层调用本 hook 持有宽度 override 状态——FeedbackTable / CustomerVisitTable 这类
 *   内部组件在 tab 切换、Empty 早退时卸载重挂，state 放它们内部会丢宽度。
 * - 返回 decorateColumns(columns)：给可拖列注入 onHeaderCell 拖拽手柄并应用 override 宽度。
 * - 排除规则见 lib/columnWidths.js isResizableColumn（fixed / 操作列 / 无 width 弹性列）。
 * - 持久化：localStorage 按 userId 隔离（拍板 2026-11-10）；user 未登录（id 为空）时
 *   仅内存态，不读写 storage——游客态零残留。
 *
 * 拖拽期间宽度经 React state 驱动重渲（rAF 节流）：antd scroll.x 模式下列宽由
 * colgroup col 控制，直接写 th.style.width 不生效，必须走 columns.width 重渲。
 *
 * 交互细节（需真机确认项）：
 * - 手柄 = 表头单元格右侧 8px 命中区（CSS ::after 实现，见 index.css .fb-col-resizable）
 * - mousedown 后 document 级 mousemove/mouseup 跟踪，松手落定写 storage
 * - 拖拽期间 body user-select 禁用（防选中文字）
 * - 双击手柄重置该列
 *
 * @param {Object} [params]
 * @param {string} [params.tableKey] 表身份键（如 'feedback.ticket' / 'postUseJira'），需全局稳定唯一
 * @param {string | undefined} [params.userId] 当前用户 id（useAuth().user?.id）
 * @returns {{
 *   decorateColumns: (columns: Array<object>) => Array<object>,
 *   resetColumnWidth: (col: object) => void,
 *   resetAllColumnWidths: () => void,
 *   hasCustomWidths: boolean,
 *   widthOverrides: Record<string, number>,
 * }}
 */
export function useColumnResize({ tableKey, userId } = {}) {
  const [widthOverrides, setWidthOverrides] = useState(() =>
    userId ? loadColumnWidths(userId, tableKey) : {}
  )

  /** @type {import('react').MutableRefObject<null | {
   *   identityKey: string, startX: number, startWidth: number,
   *   finalWidth: number, moved: boolean,
   *   rafId: number | null,
   * }>} */
  const dragSessionRef = useRef(null)
  const userIdRef = useRef(userId)
  userIdRef.current = userId

  const persist = useCallback(
    /** @param {Record<string, number>} next */
    (next) => {
      const uid = userIdRef.current
      if (!uid) return // 未登录不持久化，内存态即可
      if (Object.keys(next).length === 0) clearColumnWidths(uid, tableKey)
      else saveColumnWidths(uid, tableKey, next)
    },
    [tableKey]
  )

  /** 结束拖拽会话：取消挂起 rAF、恢复 user-select、有位移才落定持久化 */
  const endDragSession = useCallback(() => {
    const session = dragSessionRef.current
    dragSessionRef.current = null
    if (typeof document !== 'undefined') {
      document.body.classList.remove('fb-col-resizing')
    }
    if (!session) return
    if (session.rafId != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(session.rafId)
    }
    if (!session.moved) return // 原地点击（如双击重置的第一击）：不写 state 不持久化
    const identityKey = session.identityKey
    const finalWidth = session.finalWidth
    setWidthOverrides((prev) => {
      const next = { ...prev, [identityKey]: finalWidth }
      persist(next)
      return next
    })
  }, [persist])

  /**
   * 单列拖拽入口（onHeaderCell 注入用）。
   * @param {object} col 装饰后的列（width 已含 override，作为拖拽起点）
   * @param {number} startClientX mousedown 的 clientX
   */
  const beginColumnDrag = useCallback((col, startClientX) => {
    const identityKey = columnIdentityKey(col)
    if (!identityKey) return
    if (typeof document !== 'undefined') {
      document.body.classList.add('fb-col-resizing')
    }
    dragSessionRef.current = {
      identityKey,
      startX: startClientX,
      startWidth: col.width,
      finalWidth: col.width,
      moved: false,
      rafId: null,
    }
  }, [])

  // document 级 mousemove/mouseup：一次挂载常驻（无拖拽会话时零开销早退）
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onMouseMove = (/** @type {MouseEvent} */ e) => {
      const session = dragSessionRef.current
      if (!session) return
      const delta = e.clientX - session.startX
      const next = clampColumnWidth(session.startWidth + delta)
      if (next === session.finalWidth && session.moved) return
      session.moved = true
      session.finalWidth = next
      const identityKey = session.identityKey
      // rAF 节流：每帧最多一次 setState → antd 重渲 colgroup（60fps 上限天然节流）
      if (session.rafId == null) {
        session.rafId = requestAnimationFrame(() => {
          if (dragSessionRef.current !== session) return
          session.rafId = null
          setWidthOverrides((prev) => ({ ...prev, [identityKey]: next }))
        })
      }
    }
    const onMouseUp = () => {
      if (dragSessionRef.current) endDragSession()
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [endDragSession])

  // 卸载兜底：拖拽中途组件卸载，恢复 user-select、取消挂起 rAF
  useEffect(() => {
    return () => {
      const session = dragSessionRef.current
      if (session?.rafId != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(session.rafId)
      }
      if (typeof document !== 'undefined') {
        document.body.classList.remove('fb-col-resizing')
      }
    }
  }, [])

  /** 双击重置单列（手柄 dblclick） */
  const resetColumnWidth = useCallback(
    /** @param {object} col */
    (col) => {
      const identityKey = columnIdentityKey(col)
      if (!identityKey) return
      setWidthOverrides((prev) => {
        if (!(identityKey in prev)) return prev
        const next = { ...prev }
        delete next[identityKey]
        persist(next)
        return next
      })
    },
    [persist]
  )

  /** 全表重置（重置入口用） */
  const resetAllColumnWidths = useCallback(() => {
    setWidthOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev
      const uid = userIdRef.current
      if (uid) clearColumnWidths(uid, tableKey)
      return {}
    })
  }, [tableKey])

  /** 命中区判定：仅表头单元格右侧 RESIZER_HIT_ZONE px 内启动拖拽/重置 */
  const isInHitZone = (/** @type {React.MouseEvent<HTMLElement>} */ e) => {
    const target = /** @type {HTMLElement} */ (e.currentTarget)
    const rect = target.getBoundingClientRect()
    if (!rect.width) return false
    return e.clientX >= rect.right - RESIZER_HIT_ZONE
  }

  /**
   * 列装饰器：应用 override 宽度 + 给可拖列挂手柄。
   * 调用顺序约束：先 decorateColumns 再 filterVisibleColumns（hiddenColumns 过滤）——
   * 手柄按完整列集挂，隐藏列被滤掉后无残留（见方案 v2 修正 4）。
   */
  const decorateColumns = useCallback(
    /** @param {Array<object>} columns */
    (columns) => {
      const withWidths = applyColumnWidths(columns, widthOverrides)
      if (!Array.isArray(withWidths)) return withWidths
      return withWidths.map((col) => {
        if (!isResizableColumn(col)) return col
        const identityKey = columnIdentityKey(col)
        if (!identityKey) return col
        /** @type {any} */
        const prevOnHeaderCell = col.onHeaderCell
        return {
          ...col,
          onHeaderCell: (record, index) => {
            const prevProps =
              typeof prevOnHeaderCell === 'function' ? prevOnHeaderCell(record, index) : undefined
            return {
              ...prevProps,
              'data-col-key': identityKey,
              className: 'fb-col-resizable',
              onMouseDown: (/** @type {React.MouseEvent<HTMLElement>} */ e) => {
                if (!isInHitZone(e)) return
                e.preventDefault() // 防拖拽中选中文本
                beginColumnDrag(col, e.clientX)
              },
              onDoubleClick: (/** @type {React.MouseEvent<HTMLElement>} */ e) => {
                if (!isInHitZone(e)) return
                resetColumnWidth(col)
              },
            }
          },
        }
      })
    },
    [widthOverrides, beginColumnDrag, resetColumnWidth]
  )

  return useMemo(
    () => ({
      decorateColumns,
      resetColumnWidth,
      resetAllColumnWidths,
      hasCustomWidths: Object.keys(widthOverrides).length > 0,
      widthOverrides,
    }),
    [decorateColumns, resetColumnWidth, resetAllColumnWidths, widthOverrides]
  )
}
