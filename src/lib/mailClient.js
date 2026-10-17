import { apiFetch } from './apiClient.js'

export function loadMailStatus() {
  return apiFetch('/api/mail/status')
}

export function saveMailPublicUrl(publicAppUrl) {
  return apiFetch('/api/mail/public-url', {
    method: 'PUT',
    body: JSON.stringify({ publicAppUrl }),
  })
}

export function createMailChannel(body) {
  return apiFetch('/api/mail/channels', { method: 'POST', body: JSON.stringify(body) })
}

export function updateMailChannel(id, body) {
  return apiFetch(`/api/mail/channels/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteMailChannel(id) {
  return apiFetch(`/api/mail/channels/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function createMailGroup(body) {
  return apiFetch('/api/mail/groups', { method: 'POST', body: JSON.stringify(body) })
}

export function updateMailGroup(id, body) {
  return apiFetch(`/api/mail/groups/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteMailGroup(id) {
  return apiFetch(`/api/mail/groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function createMailTemplate(body) {
  return apiFetch('/api/mail/templates', { method: 'POST', body: JSON.stringify(body) })
}

export function updateMailTemplate(id, body) {
  return apiFetch(`/api/mail/templates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteMailTemplate(id) {
  return apiFetch(`/api/mail/templates/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function sendMail(body) {
  return apiFetch('/api/mail/send', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * @param {string} text
 */
export function textToBase64(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
