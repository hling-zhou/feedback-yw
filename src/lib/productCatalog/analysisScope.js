import { getCatalogProducts } from '../productCatalogLoader.js'
import { canonicalizeRecordProduct, resolveCatalogProduct } from './resolveCatalogProduct.js'

/** @typedef {import('../productCatalogLoader.js').CatalogProduct} CatalogProduct */

/**
 * 「产品与规格」中至少开启一项分析：投诉/咨询工单 或 用后即评。
 * @param {CatalogProduct | null | undefined} product
 */
export function isAnalysisEnabledProduct(product) {
  return Boolean(product?.enabled || product?.analysisPostUseRating)
}

/**
 * @param {CatalogProduct[] | null | undefined} products
 * @returns {CatalogProduct[]}
 */
export function getAnalysisEnabledProducts(products) {
  const list = Array.isArray(products) && products.length ? products : getCatalogProducts() || []
  return list.filter(isAnalysisEnabledProduct)
}

/**
 * 专题分析基础范围：只保留并集产品上的记录，并写成目录标准名。
 * 未知产品、两开关都关、没有产品字段的记录丢掉。不删库。
 * @template {Record<string, unknown>} T
 * @param {T[]} records
 * @param {CatalogProduct[] | null | undefined} products
 * @returns {T[]}
 */
export function scopeTopicAnalysisRecords(records, products) {
  const scoped = getAnalysisEnabledProducts(products)
  return (records || []).flatMap((record) => {
    const product = resolveCatalogProduct(record, scoped)
    if (!product) return []
    return [canonicalizeRecordProduct(record, product)]
  })
}
