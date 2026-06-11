import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useAuth } from './AuthContext.jsx'
import { useInsights } from './InsightsContext.jsx'
import { isApiStorageAdapter } from '../storage/feedbackStore.js'
import {
  clearUserTicketReview,
  listUserTicketReviews,
  markUserTicketReviewDone,
} from '../lib/ticketReviewClient.js'

/** @typedef {import('../domain/userTicketReview.js').UserTicketReviewItem} UserTicketReviewItem */
/** @typedef {import('../domain/userTicketReview.js').UserTicketReviewSource} UserTicketReviewSource */

const UserTicketReviewContext = createContext(null)

export function UserTicketReviewProvider({ children }) {
  const { isAuthenticated } = useAuth()
  const { adapter, storageReady } = useInsights()
  const enabled = storageReady && isApiStorageAdapter(adapter)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState(/** @type {UserTicketReviewItem[]} */ ([]))

  const doneRecordIds = useMemo(() => new Set(items.map((item) => item.recordId)), [items])

  const refreshReviews = useCallback(async () => {
    if (!enabled || !isAuthenticated) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      const next = await listUserTicketReviews()
      setItems(next)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [enabled, isAuthenticated])

  useEffect(() => {
    void refreshReviews()
  }, [refreshReviews])

  const isReviewDone = useCallback(
    (recordId) => Boolean(recordId && doneRecordIds.has(recordId)),
    [doneRecordIds],
  )

  const markReviewDone = useCallback(
    /**
     * @param {string} recordId
     * @param {UserTicketReviewSource} source
     */
    async (recordId, source) => {
      if (!enabled || !recordId) return null
      const item = await markUserTicketReviewDone(recordId, source)
      setItems((prev) => {
        const rest = prev.filter((row) => row.recordId !== item.recordId)
        return [item, ...rest]
      })
      return item
    },
    [enabled],
  )

  const clearReview = useCallback(
    async (recordId) => {
      if (!enabled || !recordId) return
      await clearUserTicketReview(recordId)
      setItems((prev) => prev.filter((row) => row.recordId !== recordId))
    },
    [enabled],
  )

  const value = useMemo(
    () => ({
      enabled,
      loading,
      items,
      doneRecordIds,
      isReviewDone,
      markReviewDone,
      clearReview,
      refreshReviews,
    }),
    [
      enabled,
      loading,
      items,
      doneRecordIds,
      isReviewDone,
      markReviewDone,
      clearReview,
      refreshReviews,
    ],
  )

  return (
    <UserTicketReviewContext.Provider value={value}>{children}</UserTicketReviewContext.Provider>
  )
}

export function useUserTicketReviews() {
  const ctx = useContext(UserTicketReviewContext)
  if (!ctx) {
    throw new Error('useUserTicketReviews must be used within UserTicketReviewProvider')
  }
  return ctx
}
