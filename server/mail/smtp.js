import nodemailer from 'nodemailer'

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
