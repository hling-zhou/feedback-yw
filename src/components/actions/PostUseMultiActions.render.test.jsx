import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostUseMultiActions from './PostUseMultiActions.jsx'

describe('PostUseMultiActions rendering', () => {
  it('shows the empty list and add entry for editable records', () => {
    const html = renderToStaticMarkup(
      <PostUseMultiActions ownerType="trace" ownerId="trace-1" productKey="云专线" open={false} canEdit />,
    )
    expect(html).toContain('确立举措（0）')
    expect(html).toContain('添加举措')
    expect(html).toContain('暂无确立举措')
  })

  it('keeps the list visible without an add entry for read-only records', () => {
    const html = renderToStaticMarkup(
      <PostUseMultiActions ownerType="visit" ownerId="visit-1" productKey="云专线" open={false} canEdit={false} />,
    )
    expect(html).toContain('确立举措（0）')
    expect(html).not.toContain('添加举措')
  })
})
