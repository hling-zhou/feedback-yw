import { afterEach, describe, expect, it, vi } from 'vitest'
import * as RealXLSX from 'xlsx'

function buildWorkbookArrayBuffer() {
  const wb = RealXLSX.utils.book_new()
  const ws = RealXLSX.utils.aoa_to_sheet([
    ['工单展示流水号', '处理意见'],
    ['20260001', '已处理'],
  ])
  RealXLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return RealXLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

function createExcelFile(name = 'protected.xlsx') {
  return new File([buildWorkbookArrayBuffer()], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

async function loadParseFileWithReadMock(readImpl) {
  vi.resetModules()
  vi.doMock('xlsx', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, read: readImpl }
  })
  return import('./parseFile.js')
}

describe('parseFile password branches', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('xlsx')
    vi.clearAllMocks()
  })

  it('returns password_required for encrypted excel without password', async () => {
    const workbook = RealXLSX.read(buildWorkbookArrayBuffer(), { type: 'array' })
    const mod = await loadParseFileWithReadMock((_buffer, options) => {
      if (!options?.password) throw new Error('File is password-protected')
      return workbook
    })

    await expect(mod.parseUploadFile(createExcelFile())).rejects.toMatchObject({
      code: mod.IMPORT_PARSE_ERROR_CODES.PASSWORD_REQUIRED,
      message: '该 Excel 文件已加密，请输入密码后重试',
    })
  })

  it('parses encrypted excel when correct password is provided', async () => {
    const workbook = RealXLSX.read(buildWorkbookArrayBuffer(), { type: 'array' })
    const readMock = vi.fn((_buffer, options) => {
      if (!options?.password) throw new Error('File is password-protected')
      if (options.password !== 'secret') throw new Error('Password is incorrect')
      return workbook
    })
    const mod = await loadParseFileWithReadMock(readMock)

    const result = await mod.parseUploadFile(createExcelFile(), { password: 'secret' })

    expect(readMock).toHaveBeenCalled()
    expect(readMock.mock.calls.at(-1)?.[1]).toMatchObject({ password: 'secret' })
    expect(result.rows).toEqual([{ 工单展示流水号: '20260001', 处理意见: '已处理' }])
  })

  it('returns password_incorrect when the provided password is wrong', async () => {
    const mod = await loadParseFileWithReadMock((_buffer, options) => {
      if (!options?.password) throw new Error('File is password-protected')
      if (options.password !== 'secret') throw new Error('Password is incorrect')
      return RealXLSX.read(buildWorkbookArrayBuffer(), { type: 'array' })
    })

    await expect(mod.parseUploadFile(createExcelFile(), { password: 'wrong' })).rejects.toMatchObject({
      code: mod.IMPORT_PARSE_ERROR_CODES.PASSWORD_INCORRECT,
      message: '文件密码错误，请重新输入后重试',
    })
  })

  it('returns password_unsupported for unsupported encryption mode', async () => {
    const mod = await loadParseFileWithReadMock(() => {
      throw new Error('Unsupported password protection')
    })

    await expect(mod.parseUploadFile(createExcelFile(), { password: 'secret' })).rejects.toMatchObject({
      code: mod.IMPORT_PARSE_ERROR_CODES.PASSWORD_UNSUPPORTED,
      message: '当前暂不支持该 Excel 文件的加密方式，请先解密后再导入',
    })
  })
})
