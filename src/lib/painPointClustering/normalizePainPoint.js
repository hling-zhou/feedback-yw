/**
 * 痛点文本规范化 key（用于 exact 预合并，不改变展示原文）
 * @param {string} text
 */
export function normalizePainPointKey(text) {
  return (text || '')
    .trim()
    .toLowerCase()
    .replace(/[\u3000\s]+/g, '')
    .replace(/[，,。．！!？?；;：:""''【】[\]()（）]/g, '')
}
