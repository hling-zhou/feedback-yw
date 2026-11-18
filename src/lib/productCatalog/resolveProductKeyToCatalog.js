import { getCatalogProducts } from '../productCatalogLoader.js'
import { resolveCatalogProduct } from './resolveCatalogProduct.js'

/**
 * 产品标识归一（11-18 拍板：确立举措选择器产品默认选中当前工单产品）。
 *
 * 输入可能是目录 key（vpc）、目录中文名（虚拟私有云）或规格名（对等连接/共享带宽），
 * 输出统一归一为目录 key——ActionItemSelect 的查询/默认选中/key 通道要求稳定机器标识。
 * 解析基于浏览器进程内目录缓存（getCatalogProducts，含 disabled 产品，如 NAT网关/
 * 云监控这类 analysisPostUseRating=true 但 enabled=false 的条目），与下拉选项同源。
 *
 * 判定顺序（resolveCatalogProduct 同款语义）：
 * 1. 精确命中目录 key → 原样返回（恒等，不破坏已是正确形态的调用方）；
 * 2. 名称/规格/别名命中 → 返回目录 key；
 * 3. 全部未命中 → 原样返回（保持现状兜底：调用方传的可能是未入目录的自定义产品）。
 * 4. 空 → 空串（选择器显示空 placeholder，不猜测）。
 *
 * @param {string | undefined | null} input
 * @returns {string}
 */
export function resolveProductKeyToCatalog(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return ''
  const products = getCatalogProducts()
  if (!products.length) return raw
  const keyed = resolveCatalogProduct({ productKey: raw }, products)
  if (keyed?.key?.trim()) return keyed.key.trim()
  const named = resolveCatalogProduct({ productName: raw }, products)
  if (named?.key?.trim()) return named.key.trim()
  return raw
}
