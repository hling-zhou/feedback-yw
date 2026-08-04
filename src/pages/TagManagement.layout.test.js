import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('TagManagement tabs', () => {
  const source = fs.readFileSync(new URL('./TagManagement.jsx', import.meta.url), 'utf8')

  it('includes the post-use key customers tab in analysis dimensions', () => {
    expect(source).toContain("keyCustomers: 'key_customers'")
    expect(source).toContain("label: '重点客户'")
    expect(source).toContain('<PostUseKeyCustomersPanel readOnly={readOnly} />')
  })
})
