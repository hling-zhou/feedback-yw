import { describe, expect, it } from 'vitest'
import { displayImportFileName, parseImportFileNamePassword } from './importFilePassword.js'

describe('parseImportFileNamePassword', () => {
  it('extracts password before extension using the last #', () => {
    expect(parseImportFileNamePassword('用后即评-6月#abc123.xlsx')).toEqual({
      password: 'abc123',
      displayName: '用后即评-6月.xlsx',
    })
    expect(parseImportFileNamePassword('report#v2#secret.xls')).toEqual({
      password: 'secret',
      displayName: 'report#v2.xls',
    })
    expect(parseImportFileNamePassword('用后即评-6月＃abc123.xlsx')).toEqual({
      password: 'abc123',
      displayName: '用后即评-6月.xlsx',
    })
    expect(parseImportFileNamePassword('用后即评-6月# abc123 .xlsx')).toEqual({
      password: 'abc123',
      displayName: '用后即评-6月.xlsx',
    })
  })

  it('returns empty password when # is missing or password is empty', () => {
    expect(parseImportFileNamePassword('短信渠道.xlsx')).toEqual({
      password: '',
      displayName: '短信渠道.xlsx',
    })
    expect(parseImportFileNamePassword('短信渠道#.xlsx')).toEqual({
      password: '',
      displayName: '短信渠道#.xlsx',
    })
    expect(parseImportFileNamePassword('#only.xlsx')).toEqual({
      password: '',
      displayName: '#only.xlsx',
    })
  })

  it('displayImportFileName strips the password segment', () => {
    expect(displayImportFileName('官网#pass.csv')).toBe('官网.csv')
    expect(displayImportFileName('官网.csv')).toBe('官网.csv')
  })
})
