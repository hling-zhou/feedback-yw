export { getLocalIdbAdapter, createLocalIdbAdapter } from './localIdbAdapter.js'
export { getApiStorageAdapter, createApiStorageAdapter } from './apiStorageAdapter.js'
export { getStorageAdapter } from './getStorageAdapter.js'
export { migrateLocalToApiIfNeeded, META_KEY_LOCAL_MIGRATED } from './migrateLocalToApi.js'
export { openDatabase, resetDatabaseForTests, isMemoryBackend } from './idb.js'
export { STORES } from './schema.js'
export {
  loadFeedbacksFromAdapter,
  persistFeedbacks,
  persistRecordUpdate,
  persistRecordUpdates,
  isApiStorageAdapter,
  clearAllFeedbacks,
  migrateLegacyFeedbacksIfNeeded,
  normalizeFeedbackRecord,
} from './feedbackStore.js'
