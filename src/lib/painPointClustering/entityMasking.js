const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const VERSION_RE = /\bv?\d+(?:\.\d+){1,3}\b/gi
const LONG_ID_RE = /\b[a-zA-Z0-9_-]{8,}\b/g
const NUMBER_RE = /\b\d+\b/g

/**
 * @param {string} text
 */
export function maskPainEntities(text) {
  return String(text || '')
    .replace(IPV4_RE, ' <IP> ')
    .replace(VERSION_RE, ' <VER> ')
    .replace(LONG_ID_RE, ' <ID> ')
    .replace(NUMBER_RE, ' <NUM> ')
    .replace(/\s+/g, ' ')
    .trim()
}

