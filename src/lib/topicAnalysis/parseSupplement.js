import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { MAX_SUPPLEMENT_TEXT } from './constants.js'

function fileExtension(fileName) {
  const name = String(fileName || '').trim().toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1) : ''
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function extractDocxText(xml) {
  return decodeXmlEntities(
    [...String(xml || '').matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((match) => match[1])
      .join(''),
  ).trim()
}

function latin1FromBytes(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i])
  return out
}

function bytesFromLatin1(text) {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

function decodePdfLiteral(raw) {
  return String(raw || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
}

function extractPdfStrings(content) {
  const literals = [...String(content || '').matchAll(/\((?:\\.|[^\\)])*\)/g)]
    .map((match) => decodePdfLiteral(match[0].slice(1, -1)))
  const hexes = [...String(content || '').matchAll(/<([0-9A-Fa-f\s]+)>/g)]
    .map((match) => {
      const hex = match[1].replace(/\s+/g, '')
      if (hex.length < 4 || hex.length % 2 !== 0) return ''
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        let text = ''
        for (let i = 2; i + 1 < bytes.length; i += 2) {
          text += String.fromCharCode((bytes[i] << 8) + bytes[i + 1])
        }
        return text
      }
      return latin1FromBytes(bytes)
    })
  return [...literals, ...hexes].map((part) => part.trim()).filter(Boolean).join('\n')
}

async function inflatePdfBytes(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('当前环境无法解压 PDF 流')
  }
  const tryFormat = async (format) => {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  try {
    return await tryFormat('deflate')
  } catch {
    return tryFormat('deflate-raw')
  }
}

/**
 * @param {ArrayBuffer} buffer
 */
export async function extractPdfText(buffer) {
  const bytes = new Uint8Array(buffer)
  const raw = latin1FromBytes(bytes)
  if (!raw.startsWith('%PDF')) {
    throw new Error('不是有效的 PDF 文件')
  }
  const chunks = [extractPdfStrings(raw)]
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let match
  while ((match = streamRe.exec(raw))) {
    const dict = raw.slice(Math.max(0, match.index - 500), match.index)
    let payload = bytesFromLatin1(match[1])
    if (/FlateDecode/.test(dict)) {
      try {
        payload = await inflatePdfBytes(payload)
      } catch {
        continue
      }
    }
    chunks.push(extractPdfStrings(latin1FromBytes(payload)))
    try {
      chunks.push(new TextDecoder('utf-8', { fatal: false }).decode(payload))
    } catch {
      // ignore
    }
  }
  const text = chunks.join('\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) {
    throw new Error('未能从 PDF 提取文字。扫描件或加密 PDF 请改用 Word / Markdown / Excel')
  }
  return text.slice(0, MAX_SUPPLEMENT_TEXT)
}

function excelNotesFromSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  const notes = []
  for (const row of rows) {
    const extra = [
      row['补充说明'],
      row['内部结论'],
      row['关联单号'],
      row['用户补充'],
    ].map((value) => String(value || '').trim()).filter(Boolean)
    if (!extra.length) continue
    const anchor = [row['工单号'], row['客户名称'], row['产品']].filter(Boolean).join(' / ')
    notes.push(anchor ? `${anchor}：${extra.join('；')}` : extra.join('；'))
  }
  return { rows, notes }
}

/**
 * @param {File | Blob} file
 * @param {string} [fileName]
 */
export async function parseTopicSupplementFile(file, fileName) {
  const name = fileName || file?.name || '未命名文件'
  const ext = fileExtension(name)
  const importedAt = new Date().toISOString()
  const id = `sup-${importedAt}-${name}`.replace(/[^\w.\u4e00-\u9fa5-]+/g, '_')
  const buffer = await file.arrayBuffer()

  if (ext === 'md' || ext === 'txt') {
    const text = new TextDecoder('utf-8').decode(buffer).trim().slice(0, MAX_SUPPLEMENT_TEXT)
    if (!text) throw new Error('Markdown / 文本文件为空')
    return { id, fileName: name, format: ext === 'txt' ? 'md' : ext, importedAt, text, notes: [text.slice(0, 800)], rows: [] }
  }

  if (ext === 'docx') {
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('word/document.xml')?.async('string')
    if (!xml) throw new Error('未识别到 Word 正文')
    const text = extractDocxText(xml).slice(0, MAX_SUPPLEMENT_TEXT)
    if (!text) throw new Error('Word 正文为空')
    return { id, fileName: name, format: 'docx', importedAt, text, notes: [text.slice(0, 800)], rows: [] }
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(buffer, { type: 'array' })
    const notes = []
    const texts = []
    const allRows = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const parsed = excelNotesFromSheet(sheet)
      allRows.push(...parsed.rows)
      notes.push(...parsed.notes)
      const csv = XLSX.utils.sheet_to_csv(sheet).trim()
      if (csv) texts.push(`# ${sheetName}\n${csv}`)
    }
    const text = texts.join('\n\n').slice(0, MAX_SUPPLEMENT_TEXT)
    if (!text) throw new Error('Excel 内容为空')
    return {
      id,
      fileName: name,
      format: 'xlsx',
      importedAt,
      text,
      notes: notes.length ? notes.slice(0, 40) : [text.slice(0, 800)],
      rows: allRows.slice(0, 200),
    }
  }

  if (ext === 'pdf') {
    const text = await extractPdfText(buffer)
    return { id, fileName: name, format: 'pdf', importedAt, text, notes: [text.slice(0, 800)], rows: [] }
  }

  throw new Error('仅支持导入 Markdown、Word、PDF、Excel')
}
