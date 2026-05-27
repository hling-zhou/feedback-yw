import { describe, expect, it } from 'vitest'
import {
  combineImportFileSha256,
  headersMatch,
  mergeParsedUploadFiles,
  MAX_ROWS_BATCH_TOTAL,
} from './importBatchFiles.js'

describe('importBatchFiles', () => {
  it('headersMatch compares sorted columns', () => {
    expect(headersMatch(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(headersMatch(['a'], ['a', 'b'])).toBe(false)
  })

  it('mergeParsedUploadFiles concatenates rows with sources', () => {
    const merged = mergeParsedUploadFiles([
      {
        id: '1',
        file: new File([], 'a.xlsx'),
        sha256: 'h1',
        sheetNames: ['S1'],
        selectedSheet: 'S1',
        headers: ['col'],
        rows: [{ col: '1' }, { col: '2' }],
      },
      {
        id: '2',
        file: new File([], 'b.xlsx'),
        sha256: 'h2',
        sheetNames: ['S1'],
        selectedSheet: 'S1',
        headers: ['col'],
        rows: [{ col: '3' }],
      },
    ])
    expect(merged.totalRows).toBe(3)
    expect(merged.rowSources[2].fileName).toBe('b.xlsx')
  })

  it('rejects header mismatch', () => {
    expect(() =>
      mergeParsedUploadFiles([
        {
          id: '1',
          file: new File([], 'a.xlsx'),
          sha256: 'h1',
          sheetNames: [],
          selectedSheet: '',
          headers: ['a'],
          rows: [{}],
        },
        {
          id: '2',
          file: new File([], 'b.xlsx'),
          sha256: 'h2',
          sheetNames: [],
          selectedSheet: '',
          headers: ['b'],
          rows: [{}],
        },
      ]),
    ).toThrow(/表头/)
  })

  it('combineImportFileSha256 sorts hashes', () => {
    expect(combineImportFileSha256(['b', 'a'])).toBe('a|b')
  })

  it('enforces batch row cap', () => {
    const big = Array.from({ length: MAX_ROWS_BATCH_TOTAL + 1 }, () => ({}))
    expect(() =>
      mergeParsedUploadFiles([
        {
          id: '1',
          file: new File([], 'a.xlsx'),
          sha256: 'h1',
          sheetNames: [],
          selectedSheet: '',
          headers: ['c'],
          rows: big,
        },
      ]),
    ).toThrow(/合并后/)
  })
})
