import { isDataSourceType } from '../domain/enums.js'
import {
  POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE,
  POST_USE_RATING_SUBTYPE_OPTIONS,
} from '../domain/postUseRatingImport.js'

/**
 * 数据导入页地址。带上来源时，「数据来源」下拉会自动选中。
 *
 * @param {{ source?: string | null; subType?: string | null }} [opts]
 * @returns {string}
 */
export function buildImportUrl(opts = {}) {
  const params = new URLSearchParams()
  const source = String(opts.source || '').trim()
  if (isDataSourceType(source)) {
    params.set('source', source)
    if (source === 'post_use_rating') {
      const sub = POST_USE_RATING_SUBTYPE_OPTIONS.find((item) => item.value === opts.subType)?.value
      params.set('subType', sub || POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE)
    }
  }
  const query = params.toString()
  return query ? `/import?${query}` : '/import'
}
