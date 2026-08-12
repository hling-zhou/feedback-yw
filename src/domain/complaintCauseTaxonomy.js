/**
 * 投诉原因（终判）拟复核用三级标签树（源自附件1）。
 */

import taxonomyJson from '../data/complaintCauseTaxonomy.json' with { type: 'json' }

/**
 * @typedef {{ label: string; children?: ComplaintCauseTaxonomyNode[] }} ComplaintCauseTaxonomyNode
 */

/** @type {ComplaintCauseTaxonomyNode[]} */
export const COMPLAINT_CAUSE_TAXONOMY = taxonomyJson

/**
 * Ant Design Cascader options（value === label）。
 * @returns {{ label: string; value: string; children?: object[] }[]}
 */
export function getComplaintCauseCascaderOptions() {
  return COMPLAINT_CAUSE_TAXONOMY.map((l1) => ({
    label: l1.label,
    value: l1.label,
    children: (l1.children || []).map((l2) => ({
      label: l2.label,
      value: l2.label,
      children: (l2.children || []).map((l3) => ({
        label: l3.label,
        value: l3.label,
      })),
    })),
  }))
}

/**
 * @param {string} l1
 * @returns {string[]}
 */
export function listComplaintCauseL2Options(l1) {
  const node = COMPLAINT_CAUSE_TAXONOMY.find((item) => item.label === l1)
  return (node?.children || []).map((c) => c.label)
}

/**
 * @param {string} l1
 * @param {string} l2
 * @returns {string[]}
 */
export function listComplaintCauseL3Options(l1, l2) {
  const l1Node = COMPLAINT_CAUSE_TAXONOMY.find((item) => item.label === l1)
  const l2Node = (l1Node?.children || []).find((item) => item.label === l2)
  return (l2Node?.children || []).map((c) => c.label)
}

/**
 * 校验三级路径是否在标签树中（允许三级为空，若该二级下确无三级）。
 *
 * @param {{ l1?: string; l2?: string; l3?: string }} path
 */
export function isValidComplaintCausePath(path) {
  const l1 = String(path?.l1 ?? '').trim()
  const l2 = String(path?.l2 ?? '').trim()
  const l3 = String(path?.l3 ?? '').trim()
  if (!l1 || !l2) return false
  const l2Options = listComplaintCauseL2Options(l1)
  if (!l2Options.includes(l2)) return false
  const l3Options = listComplaintCauseL3Options(l1, l2)
  if (!l3Options.length) return !l3
  return l3Options.includes(l3)
}
