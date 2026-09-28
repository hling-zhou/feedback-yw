import { cbc } from '@noble/ciphers/aes'
import { hmac } from '@noble/hashes/hmac'
import { sha1 } from '@noble/hashes/sha1'
import { sha256, sha384, sha512 } from '@noble/hashes/sha2'

const HASHES = {
  'SHA-1': sha1,
  'SHA-256': sha256,
  'SHA-384': sha384,
  'SHA-512': sha512,
}

/**
 * @param {string | { name?: string; hash?: string | { name?: string } }} algorithm
 */
function hashFn(algorithm) {
  const name = normalizeHashName(algorithm)
  const hash = HASHES[name]
  if (!hash) throw new Error(`Unsupported hash algorithm: ${name}`)
  return hash
}

/**
 * @param {string | { name?: string; hash?: string | { name?: string } }} algorithm
 */
function normalizeHashName(algorithm) {
  if (typeof algorithm === 'string') {
    const upper = algorithm.toUpperCase()
    if (upper in HASHES) return upper
    const hyphenated = upper.replace(/^SHA(?=\d)/, 'SHA-')
    if (hyphenated in HASHES) return hyphenated
    throw new Error(`Unsupported hash algorithm: ${algorithm}`)
  }
  if (algorithm && typeof algorithm === 'object') {
    if (algorithm.hash) return normalizeHashName(algorithm.hash)
    if (algorithm.name && algorithm.name.toUpperCase() !== 'HMAC') return normalizeHashName(algorithm.name)
  }
  throw new Error('Unsupported hash algorithm')
}

/**
 * @param {BufferSource} data
 */
function copyBytes(data) {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data)
  return new Uint8Array(view)
}

/**
 * @param {Uint8Array} bytes
 */
function asBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/**
 * @param {{ name?: string }} params
 */
function assertAesCbc(params) {
  if (params?.name !== 'AES-CBC') throw new Error('Only AES-CBC is supported')
}

/**
 * 非安全上下文（http + 非 localhost）里浏览器没有 crypto.subtle。
 * 用纯 JS 实现 ooxml-encryption 实际调用的 digest / HMAC / AES-CBC。
 */
export const pureSubtle = {
  /**
   * @param {string | { name?: string }} algorithm
   * @param {BufferSource} data
   */
  async digest(algorithm, data) {
    return asBuffer(hashFn(algorithm)(copyBytes(data)))
  },

  /**
   * @param {string} format
   * @param {BufferSource} keyData
   * @param {string | { name?: string; hash?: string | { name?: string } }} algorithm
   * @param {boolean} _extractable
   * @param {string[]} usages
   */
  async importKey(format, keyData, algorithm, _extractable, usages) {
    if (format !== 'raw') throw new Error('Only raw keys are supported')
    return { algorithm, usages, key: copyBytes(keyData) }
  },

  /**
   * @param {string} _algorithm
   * @param {{ algorithm: string | { name?: string; hash?: string | { name?: string } }; key: Uint8Array }} key
   * @param {BufferSource} data
   */
  async sign(_algorithm, key, data) {
    return asBuffer(hmac(hashFn(key.algorithm), key.key, copyBytes(data)))
  },

  /**
   * @param {{ name?: string; iv: BufferSource }} params
   * @param {{ key: Uint8Array }} key
   * @param {BufferSource} data
   */
  async encrypt(params, key, data) {
    assertAesCbc(params)
    return asBuffer(cbc(copyBytes(key.key), copyBytes(params.iv)).encrypt(copyBytes(data)))
  },

  /**
   * @param {{ name?: string; iv: BufferSource }} params
   * @param {{ key: Uint8Array }} key
   * @param {BufferSource} data
   */
  async decrypt(params, key, data) {
    assertAesCbc(params)
    return asBuffer(cbc(copyBytes(key.key), copyBytes(params.iv)).decrypt(copyBytes(data)))
  },
}

export function getSubtle() {
  const native = globalThis.crypto?.subtle
  if (native) return native
  return pureSubtle
}
