/**
 * @param {{ id?: string, userId?: string, username?: string } | null | undefined} user
 */
export function topicActorFromUser(user) {
  const userId = String(user?.userId || user?.id || '').trim()
  const username = String(user?.username || userId).trim()
  if (!userId) return null
  return { userId, username }
}

/**
 * @param {{ userId?: string, username?: string } | null | undefined} actor
 * @param {{ id?: string, userId?: string } | null | undefined} user
 */
export function isOwnTopicActor(actor, user) {
  const uid = String(user?.userId || user?.id || '').trim()
  const actorId = String(actor?.userId || '').trim()
  return Boolean(uid && actorId && uid === actorId)
}

/**
 * 保存时：创建人一旦有就不再改；updatedBy 有新值才覆盖，否则保留已有。
 * @param {object} incoming
 * @param {object | null | undefined} existing
 */
export function preserveTopicReportActors(incoming, existing) {
  return {
    ...incoming,
    createdBy: existing?.createdBy || incoming?.createdBy || null,
    updatedBy: incoming?.updatedBy || existing?.updatedBy || null,
  }
}

/**
 * @param {object} report
 * @param {{ id?: string, userId?: string, username?: string } | null | undefined} user
 */
export function topicReportCreatedByLabel(report, user) {
  if (!report?.createdBy?.userId && !report?.createdBy?.username) return '未知创建人'
  if (isOwnTopicActor(report.createdBy, user)) return '我创建的'
  return `${report.createdBy.username || report.createdBy.userId} 创建`
}

/**
 * @param {object} report
 * @param {{ id?: string, userId?: string, username?: string } | null | undefined} user
 */
export function topicReportUpdatedByLabel(report, user) {
  if (!report?.updatedBy?.userId && !report?.updatedBy?.username) return ''
  if (isOwnTopicActor(report.updatedBy, user)) return '我上传了补充材料'
  return `${report.updatedBy.username || report.updatedBy.userId} 上传了补充材料`
}

/**
 * @param {object[]} reports
 * @param {{ id?: string, userId?: string } | null | undefined} user
 */
export function sortTopicReportsForViewer(reports, user) {
  return [...(reports || [])].sort((a, b) => {
    const aMine = isOwnTopicActor(a?.createdBy, user) ? 0 : 1
    const bMine = isOwnTopicActor(b?.createdBy, user) ? 0 : 1
    if (aMine !== bMine) return aMine - bMine
    return String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || ''))
  })
}
