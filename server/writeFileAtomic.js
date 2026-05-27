import fs from 'node:fs'

/**
 * 写入二进制并校验；Excel 打开时 rename 可能失败，会尝试直接覆盖。
 * @param {string} filePath
 * @param {Buffer} buffer
 */
export function writeBufferAtomically(filePath, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) {
    throw new Error('生成的文件内容无效，写入已取消')
  }

  const tmpPath = `${filePath}.publish-${process.pid}.tmp`
  fs.writeFileSync(tmpPath, buffer)

  try {
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      try {
        fs.copyFileSync(tmpPath, filePath)
        fs.unlinkSync(tmpPath)
      } catch (copyErr) {
        try {
          fs.unlinkSync(tmpPath)
        } catch {
          /* ignore */
        }
        throw new Error(
          `无法覆盖「${filePath}」：请先关闭 Excel/WPS 中打开的该文件后重试`,
          { cause: copyErr },
        )
      }
    } else {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      throw err
    }
  }

  const stat = fs.statSync(filePath)
  if (stat.size < 32) {
    throw new Error(`写入后文件大小异常（${stat.size} 字节），请关闭 Excel 后重试`)
  }

  return {
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  }
}
