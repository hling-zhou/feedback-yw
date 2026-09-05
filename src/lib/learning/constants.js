export const META_KEY_TAG_CORRECTION_EVENTS = 'tag_correction_events_v1'
export const META_KEY_TAG_CORRECTION_RULES = 'tag_correction_rules_v1'
export const META_KEY_TAG_CORRECTION_REPLAY = 'tag_correction_replay_v1'
export const META_KEY_PLAYBOOK_OVERRIDES = 'planning_playbook_overrides'
export const META_KEY_PLAYBOOK_PROMOTION = 'playbook_promotion_state_v1'

export const TAG_CORRECTION_MIN_EVIDENCE = 3
export const TAG_CORRECTION_MIN_MONTHS = 2
export const TAG_CORRECTION_EVENTS_CAP = 4000

/** @typedef {'requestScene' | 'problemType' | 'journey'} TagCorrectionDimension */

/** @type {TagCorrectionDimension[]} */
export const TAG_CORRECTION_DIMENSIONS = ['requestScene', 'problemType', 'journey']

export const TAG_CORRECTION_DIMENSION_LABELS = {
  requestScene: '请求场景',
  problemType: '问题类型',
  journey: '用户旅程',
}

/** @typedef {'pending' | 'approved' | 'rejected' | 'needs_tree_patch' | 'tree_patched'} TagCorrectionRuleStatus */
