// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostUseAttachments from './PostUseAttachments.jsx'

describe('PostUseAttachments', () => {
  it('renders a multi-file drop zone for editors and a readable empty state', () => {
    const html = renderToStaticMarkup(
      <PostUseAttachments ownerType="visit" ownerId="visit-1" open canEdit />,
    )
    expect(html).toContain('选择或拖入附件上传')
    expect(html).toContain('multiple')
    expect(html).toContain('图片、PDF、Word、Excel、CSV')
    expect(html).toContain('暂无附件')
  })

  it('keeps the attachment list visible to viewers without an upload control', () => {
    const html = renderToStaticMarkup(
      <PostUseAttachments ownerType="trace" ownerId="trace-1" open canEdit={false} />,
    )
    expect(html).toContain('附件（0）')
    expect(html).not.toContain('选择或拖入附件上传')
  })
})
