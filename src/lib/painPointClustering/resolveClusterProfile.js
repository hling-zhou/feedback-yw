import { complaintClusterProfile } from './profiles/complaintProfile.js'
import { consultationClusterProfile } from './profiles/consultationProfile.js'
import { overviewClusterProfile } from './profiles/overviewProfile.js'

/**
 * @param {{
 *   scenario?: 'complaint' | 'consultation' | 'overview'
 *   sourceType?: import('../../domain/enums.js').DataSourceType
 *   profileId?: string
 * }} [input]
 */
export function resolveClusterProfile(input = {}) {
  if (input.profileId === 'complaint') return complaintClusterProfile
  if (input.profileId === 'consultation') return consultationClusterProfile
  if (input.profileId === 'overview') return overviewClusterProfile

  if (input.scenario === 'complaint' || input.sourceType === 'complaint_ticket') {
    return complaintClusterProfile
  }
  if (input.scenario === 'consultation' || input.sourceType === 'consultation_ticket') {
    return consultationClusterProfile
  }
  if (input.scenario === 'overview') return overviewClusterProfile
  return complaintClusterProfile
}

