import { getSubtle } from './webcryptoSubtle.js'

const aesBlockSize = 16

/**
 * ooxml-encryption 的 WebCrypto 封装。
 * 安全上下文走浏览器实现；否则走纯 JS，避免 http 部署上报
 * “WebCrypto subtle API is unavailable”。
 */

/**
 * @param {Uint8Array[]} chunks
 */
function concatBytes(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * @param {Uint8Array} bytes
 */
function toCryptoBytes(bytes) {
  return new Uint8Array(bytes)
}

function subtle() {
  return getSubtle()
}

function globalCrypto() {
  if (!globalThis.crypto) throw new Error('WebCrypto is unavailable')
  return globalThis.crypto
}

/**
 * @param {string} algorithm
 * @param {Uint8Array} bytes
 */
export async function digest(algorithm, bytes) {
  const result = await subtle().digest(algorithm, toCryptoBytes(bytes))
  return new Uint8Array(result)
}

/**
 * @param {string} algorithm
 * @param {Uint8Array} keyBytes
 * @param {Uint8Array} bytes
 */
export async function hmac(algorithm, keyBytes, bytes) {
  const key = await subtle().importKey(
    'raw',
    toCryptoBytes(keyBytes),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  )
  const result = await subtle().sign('HMAC', key, toCryptoBytes(bytes))
  return new Uint8Array(result)
}

/**
 * @param {Uint8Array} keyBytes
 * @param {Uint8Array} iv
 * @param {Uint8Array} bytes
 */
export async function aesCbcEncrypt(keyBytes, iv, bytes) {
  const key = await importAesKey(keyBytes, ['encrypt'])
  const result = await subtle().encrypt(
    { name: 'AES-CBC', iv: toCryptoBytes(iv) },
    key,
    toCryptoBytes(bytes),
  )
  return new Uint8Array(result)
}

/**
 * @param {Uint8Array} keyBytes
 * @param {Uint8Array} iv
 * @param {Uint8Array} bytes
 */
export async function aesCbcDecrypt(keyBytes, iv, bytes) {
  const key = await importAesKey(keyBytes, ['decrypt'])
  const result = await subtle().decrypt(
    { name: 'AES-CBC', iv: toCryptoBytes(iv) },
    key,
    toCryptoBytes(bytes),
  )
  return new Uint8Array(result)
}

/**
 * @param {Uint8Array} keyBytes
 * @param {Uint8Array} iv
 * @param {Uint8Array} bytes
 */
export async function aesCbcEncryptBlockPadded(keyBytes, iv, bytes) {
  if (bytes.length % aesBlockSize !== 0) throw new Error('AES-CBC raw input must be block aligned')
  if (bytes.length === 0) return new Uint8Array()
  const encrypted = await aesCbcEncrypt(keyBytes, iv, bytes)
  return encrypted.slice(0, encrypted.length - aesBlockSize)
}

/**
 * @param {Uint8Array} keyBytes
 * @param {Uint8Array} iv
 * @param {Uint8Array} bytes
 */
export async function aesCbcDecryptBlockPadded(keyBytes, iv, bytes) {
  if (bytes.length % aesBlockSize !== 0) throw new Error('AES-CBC raw input must be block aligned')
  if (bytes.length === 0) return new Uint8Array()
  const key = await importAesKey(keyBytes, ['encrypt', 'decrypt'])
  const lastCipherBlock = bytes.slice(bytes.length - aesBlockSize)
  const syntheticPlainBlock = new Uint8Array(aesBlockSize)
  syntheticPlainBlock.fill(aesBlockSize)
  for (let i = 0; i < syntheticPlainBlock.length; i += 1) {
    syntheticPlainBlock[i] = syntheticPlainBlock[i] ^ lastCipherBlock[i]
  }
  const syntheticEncrypted = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-CBC', iv: toCryptoBytes(new Uint8Array(aesBlockSize)) },
      key,
      toCryptoBytes(syntheticPlainBlock),
    ),
  )
  const combined = concatBytes([bytes, syntheticEncrypted.slice(0, aesBlockSize)])
  const decrypted = await subtle().decrypt(
    { name: 'AES-CBC', iv: toCryptoBytes(iv) },
    key,
    toCryptoBytes(combined),
  )
  return new Uint8Array(decrypted)
}

/**
 * @param {number} length
 */
export function randomBytes(length) {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('Random byte length must be non-negative')
  }
  const output = new Uint8Array(length)
  globalCrypto().getRandomValues(output)
  return output
}

/**
 * @param {Uint8Array} keyBytes
 * @param {string[]} usages
 */
function importAesKey(keyBytes, usages) {
  return subtle().importKey('raw', toCryptoBytes(keyBytes), 'AES-CBC', false, usages)
}
