import { describe, expect, it } from 'vitest'
import { pureSubtle } from './webcryptoSubtle.js'

describe('pureSubtle', () => {
  it('matches native SHA-512, HMAC and AES-CBC', async () => {
    const native = globalThis.crypto.subtle
    const data = new TextEncoder().encode('用后即评')
    const keyBytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(16))

    const nativeDigest = new Uint8Array(await native.digest('SHA-512', data))
    const pureDigest = new Uint8Array(await pureSubtle.digest('SHA-512', data))
    expect(pureDigest).toEqual(nativeDigest)

    const nativeHmacKey = await native.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
    const pureHmacKey = await pureSubtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
    const nativeMac = new Uint8Array(await native.sign('HMAC', nativeHmacKey, data))
    const pureMac = new Uint8Array(await pureSubtle.sign('HMAC', pureHmacKey, data))
    expect(pureMac).toEqual(nativeMac)

    const nativeAesKey = await native.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt', 'decrypt'])
    const pureAesKey = await pureSubtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt', 'decrypt'])
    const nativeCipher = new Uint8Array(await native.encrypt({ name: 'AES-CBC', iv }, nativeAesKey, data))
    const pureCipher = new Uint8Array(await pureSubtle.encrypt({ name: 'AES-CBC', iv }, pureAesKey, data))
    expect(pureCipher).toEqual(nativeCipher)
    const roundTrip = new Uint8Array(await pureSubtle.decrypt({ name: 'AES-CBC', iv }, pureAesKey, nativeCipher))
    expect(roundTrip).toEqual(data)
  })
})