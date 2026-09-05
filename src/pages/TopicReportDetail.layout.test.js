import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('TopicReportDetail layout', () => {
  const src = readFileSync(
    resolve(import.meta.dirname, 'TopicReportDetail.jsx'),
    'utf8',
  )

  it('offers markdown copy on the ready report toolbar', () => {
    expect(src).toContain('复制 Markdown')
    expect(src).toContain('buildTopicMarkdown')
    expect(src).toContain('handleCopyMarkdown')
  })
})
