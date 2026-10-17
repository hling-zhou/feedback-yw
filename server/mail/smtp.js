import nodemailer from 'nodemailer'

const ERROR_MAX_LEN = 280

function clipError(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length <= ERROR_MAX_LEN) return value
  return `${value.slice(0, ERROR_MAX_LEN - 1)}…`
}

function stripSecrets(text) {
  return String(text || '')
    .replace(/pass(?:word)?[=:]\s*\S+/gi, 'password=***')
    .replace(/\/\/[^/\s:]+:[^@\s]+@/g, '//***:***@')
}

/**
 * 把 nodemailer / 网络错误转成可给操作者看的原因，不回传密码。
 * @param {unknown} err
 */
export function describeMailSendError(err) {
  if (!err) return '邮件发送失败'
  const code = String(/** @type {{ code?: string, errno?: string }} */ (err).code
    || /** @type {{ errno?: string }} */ (err).errno
    || '')
  const response = stripSecrets(
    String(/** @type {{ response?: string }} */ (err).response || ''),
  ).trim()
  const rawMessage =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String(/** @type {{ message?: unknown }} */ (err).message || '')
        : String(err)
  const raw = stripSecrets(rawMessage).trim()
  const combined = `${code} ${raw} ${response}`

  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timeout/i.test(raw)) {
    return '连接 SMTP 超时。请确认主机、端口，以及运行 API 的机器能否访问该服务器。'
  }
  if (code === 'ECONNREFUSED') {
    return 'SMTP 拒绝连接。请确认主机和端口是否可达。'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return '找不到 SMTP 主机。请检查 SMTP 主机填写是否正确。'
  }
  if (code === 'ECONNRESET' || /wrong version number|ssl routines/i.test(combined)) {
    return 'SMTP 连接被断开，或 SSL/TLS 与端口不匹配。465 需开启 SSL，25 通常关闭 SSL。'
  }
  if (code === 'EAUTH' || /invalid login|authentication failed|\b535\b/i.test(combined)) {
    const detail = response || raw
    return clipError(detail ? `SMTP 认证失败：${detail}` : 'SMTP 认证失败，请检查账号和密码（或授权码）。')
  }
  if (response) return clipError(`邮件发送失败：${response}`)
  if (raw) return clipError(`邮件发送失败：${raw}`)
  return '邮件发送失败'
}

/** @type {(options: object) => { sendMail: Function }} */
let transportFactory = (options) => nodemailer.createTransport(options)

/**
 * @param {(options: object) => { sendMail: Function }} factory
 */
export function setMailTransportFactory(factory) {
  transportFactory = factory
}

export function resetMailTransportFactory() {
  transportFactory = (options) => nodemailer.createTransport(options)
}

/**
 * @param {{
 *   host: string
 *   port: number
 *   secure: boolean
 *   username?: string
 *   password?: string
 *   fromAddress: string
 * }} channel
 * @param {{
 *   to: string[]
 *   cc?: string[]
 *   subject: string
 *   text: string
 *   html?: string
 *   attachments?: { filename: string, content: Buffer, contentType?: string }[]
 * }} message
 */
export async function sendSmtpMail(channel, message) {
  const transporter = transportFactory({
    host: channel.host,
    port: channel.port,
    secure: Boolean(channel.secure),
    auth:
      channel.username || channel.password
        ? { user: channel.username || channel.fromAddress, pass: channel.password || '' }
        : undefined,
  })
  return transporter.sendMail({
    from: channel.fromAddress,
    replyTo: channel.fromAddress,
    to: message.to.join(', '),
    cc: message.cc?.length ? message.cc.join(', ') : undefined,
    subject: message.subject,
    text: message.text,
    html: message.html || undefined,
    attachments: message.attachments,
  })
}
