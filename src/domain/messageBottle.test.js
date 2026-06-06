import { describe, expect, it } from 'vitest'
import {
  MESSAGE_BOTTLE_ATTACHMENT_MAX_BYTES,
  validateMessageBottleAttachments,
} from './messageBottle.js'

describe('messageBottle', () => {
  it('validateMessageBottleAttachments accepts image data urls', () => {
    expect(
      validateMessageBottleAttachments([
        {
          dataUrl: 'data:image/png;base64,abcd',
          fileName: 'a.png',
          mimeType: 'image/png',
          size: 3,
        },
      ]),
    ).toBeNull()
  })

  it('validateMessageBottleAttachments rejects oversized payloads', () => {
    expect(
      validateMessageBottleAttachments([
        {
          dataUrl: 'data:image/png;base64,abcd',
          fileName: 'a.png',
          mimeType: 'image/png',
          size: MESSAGE_BOTTLE_ATTACHMENT_MAX_BYTES + 1,
        },
      ]),
    ).toMatch(/不能超过/)
  })
})
