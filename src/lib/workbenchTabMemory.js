/**
 * 洞察工作台 Tab 记忆（2026-11-09 需求）：从其他模块跳转进入时，默认选中
 * 上次离开时所在的 Tab（本机 localStorage 记忆，不跨设备不跨账号）。
 *
 * 优先级链（拍板）：URL 显式 ?tab= 参数 > 上次离开的 Tab > 第一个 Tab（overview）。
 * 显式参数来源：导入成功跳转、反馈库工单来源跳回、重点客户面板、月报返回、提醒邮件深链。
 */
import { IMPORTABLE_DATA_SOURCE_TYPES } from '../domain/enums.js'

const STORAGE_KEY = 'fi.workbench.lastActiveTab.v1'

/** 工作台合法 Tab 白名单：综合概述 + 可导入数据源类型（与 WorkbenchAnalysisNav 一致） */
export const WORKBENCH_TAB_WHITELIST = /** @type {const} */ ([
  'overview',
  ...IMPORTABLE_DATA_SOURCE_TYPES,
])

const WORKBENCH_TAB_SET = new Set(/** @type {readonly string[]} */ (WORKBENCH_TAB_WHITELIST))

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isValidWorkbenchTab(value) {
  return WORKBENCH_TAB_SET.has(String(value || '').trim())
}

/**
 * 读上次离开工作台时所在的 Tab；无记忆或值已不在白名单（如数据源类型增删后残留）返回空串。
 * @returns {string}
 */
export function readWorkbenchLastActiveTab() {
  try {
    const raw = String(localStorage.getItem(STORAGE_KEY) || '').trim()
    return isValidWorkbenchTab(raw) ? raw : ''
  } catch {
    /* localStorage 不可用（隐私模式/配额）时静默降级为无记忆 */
    return ''
  }
}

/**
 * @param {string} tab
 */
export function rememberWorkbenchActiveTab(tab) {
  if (!isValidWorkbenchTab(tab)) return
  try {
    localStorage.setItem(STORAGE_KEY, String(tab).trim())
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * 初始 Tab 三级优先链（纯函数，便于单测）：
 * 1. URL 显式 ?tab= 参数（合法时）
 * 2. 上次离开的 Tab（合法时）
 * 3. 第一个 Tab（overview）
 * @param {string | null | undefined} rawParam URL ?tab= 参数原值
 * @param {string} lastTab 上次离开的 Tab（readWorkbenchLastActiveTab() 产物）
 * @returns {string}
 */
export function resolveInitialWorkbenchTab(rawParam, lastTab) {
  const param = String(rawParam || '').trim()
  if (param && isValidWorkbenchTab(param)) return param
  const last = String(lastTab || '').trim()
  if (last && isValidWorkbenchTab(last)) return last
  return 'overview'
}
