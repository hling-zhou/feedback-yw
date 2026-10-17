import { describe, expect, it } from 'vitest'
import { describeMailSendError } from './smtp.js'

describe('describeMailSendError', () => {
  it('maps common SMTP codes to operator-facing reasons', () => {
    expect(describeMailSendError({ code: 'ETIMEDOUT', message: 'Greeting never received' })).toMatch(
      /超时/,
    )
    expect(describeMailSendError({ code: 'ECONNREFUSED', message: 'connect' })).toMatch(/拒绝连接/)
    expect(describeMailSendError({ code: 'ENOTFOUND', message: 'getaddrinfo' })).toMatch(/找不到 SMTP 主机/)
    expect(describeMailSendError({ code: 'ECONNRESET', message: 'socket hang up' })).toMatch(/SSL\/TLS/)
    expect(
      describeMailSendError({ code: 'EAUTH', message: 'Invalid login', response: '535 5.7.8 Error' }),
    ).toBe('SMTP 认证失败：535 5.7.8 Error')
  })

  it('falls back to the SMTP response or message instead of a generic line', () => {
    expect(describeMailSendError({ message: 'wrong version number' })).toMatch(/SSL\/TLS/)
    expect(describeMailSendError(new Error('Certificate mismatch'))).toBe(
      '邮件发送失败：Certificate mismatch',
    )
  })
})
