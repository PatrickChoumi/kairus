import type { Conversation, Message, SearchHit, Shared, User } from './types'

/** Empty in production: the server serves the client from the same origin. */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export const apiUrl = (path: string) => `${BASE}${path}`

export const socketUrl = (): string => {
  if (BASE) return BASE.replace(/^http/, 'ws') + '/socket'
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/socket`
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    /** Seconds to wait, when the server asked us to slow down. */
    readonly retryAfter?: number,
    /**
     * A refusal the interface has to act on rather than merely show —
     * `code` means the passphrase was right and a second factor is next.
     */
    readonly kind?: 'code',
  ) {
    super(message)
  }
}

let token: string | null = localStorage.getItem('kairus.token')

export const getToken = () => token

export function setToken(next: string | null): void {
  token = next
  if (next) localStorage.setItem('kairus.token', next)
  else localStorage.removeItem('kairus.token')
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body) headers.set('content-type', 'application/json')
  if (token) headers.set('authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(apiUrl(path), { ...init, headers })
  } catch {
    throw new ApiError('le réseau ne répond pas')
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const message =
      typeof payload.error === 'string' ? payload.error : 'quelque chose n’a pas fonctionné'
    const retryAfter = typeof payload.retryAfter === 'number' ? payload.retryAfter : undefined
    const kind = payload.kind === 'code' ? 'code' : undefined
    throw new ApiError(message, response.status, retryAfter, kind)
  }
  return payload as T
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

export const api = {
  register: (handle: string, name: string, password: string) =>
    request<{ token: string; user: User; recoveryPhrase: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ handle, name, password }),
    }),

  login: (handle: string, password: string, code?: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ handle, password, ...(code ? { code } : {}) }),
    }),

  /** The way back in when the passphrase is gone. */
  recover: (handle: string, phrase: string, password: string) =>
    request<{ token: string; user: User; recoveryPhrase: string }>('/api/auth/recover', {
      method: 'POST',
      body: JSON.stringify({ handle, phrase, password }),
    }),

  changePassphrase: (current: string, next: string) =>
    request<{ token: string }>('/api/account/passphrase', {
      method: 'POST',
      body: JSON.stringify({ current, next }),
    }),

  newRecoveryPhrase: () =>
    request<{ recoveryPhrase: string }>('/api/account/recovery', { method: 'POST' }),

  /** Records something. Nothing happens automatically — that is the point. */
  report: (target: { message?: string; handle?: string }, reason: string) =>
    request<{ filed: true }>('/api/reports', {
      method: 'POST',
      body: JSON.stringify({ ...target, reason }),
    }),

  removeFromGroup: (conversation: string, handle: string) =>
    request<{ removed: User }>('/api/groups/remove', {
      method: 'POST',
      body: JSON.stringify({ conversation, handle }),
    }),

  /**
   * Silences a conversation. `minutes` absent means until said otherwise, 0
   * means hear it again.
   */
  mute: (conversation: string, minutes?: number) =>
    request<{ mutedUntil: number }>('/api/mute', {
      method: 'POST',
      body: JSON.stringify(minutes === undefined ? { conversation } : { conversation, minutes }),
    }),

  /** Everything ever attached in a conversation, newest first. */
  shared: (conversation: string, kind: 'image' | 'audio' | 'file', before?: number) =>
    request<{ shared: Shared[] }>(
      `/api/shared?conversation=${encodeURIComponent(conversation)}&kind=${kind}` +
        (before ? `&before=${before}` : ''),
    ),

  /* -- the second factor -------------------------------------------------- */

  totpState: () => request<{ on: boolean; started: boolean }>('/api/account/totp'),

  /** Mints a secret. Nothing is in force until a code confirms it. */
  totpBegin: (password: string) =>
    request<{ secret: string; readable: string; uri: string }>('/api/account/totp/begin', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  totpConfirm: (code: string) =>
    request<{ on: boolean }>('/api/account/totp/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  totpOff: (password: string, code: string) =>
    request<{ on: boolean }>('/api/account/totp/off', {
      method: 'POST',
      body: JSON.stringify({ password, code }),
    }),

  revokeSessions: () => request<{ token: string }>('/api/account/revoke', { method: 'POST' }),

  /** May hand back a fresher token when the current one is getting old. */
  me: () => request<{ user: User; token?: string }>('/api/me'),

  push: () => request<{ enabled: boolean; key: string; devices: number }>('/api/push'),

  pushSubscribe: (subscription: unknown) =>
    request<{ devices: number }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    }),

  pushUnsubscribe: (endpoint: string) =>
    request<{ devices: number }>('/api/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),

  blocked: () => request<{ people: User[] }>('/api/blocks'),

  block: (handle: string) =>
    request<{ blocked: User }>('/api/blocks', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    }),

  unblock: (handle: string) =>
    request<{ unblocked: User }>('/api/blocks/remove', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    }),

  createGroup: (title: string, handles: string[]) =>
    request<{ conversation: Conversation }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ title, handles }),
    }),

  addToGroup: (conversation: string, handle: string) =>
    request<{ member: User }>('/api/groups/members', {
      method: 'POST',
      body: JSON.stringify({ conversation, handle }),
    }),

  leaveGroup: (conversation: string) =>
    request<{ left: boolean }>('/api/groups/leave', {
      method: 'POST',
      body: JSON.stringify({ conversation }),
    }),

  renameGroup: (conversation: string, title: string) =>
    request<{ title: string }>('/api/groups/rename', {
      method: 'POST',
      body: JSON.stringify({ conversation, title }),
    }),

  openConversation: (handle: string) =>
    request<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    }),

  messages: (conversation: string, before?: number) =>
    request<{ messages: Message[] }>(`/api/messages${query({ conversation, before })}`),

  people: (q: string) => request<{ people: User[] }>(`/api/people${query({ q })}`),

  /** Everywhere, or inside one conversation when `conversation` is given. */
  search: (q: string, conversation?: string) =>
    request<{ hits: SearchHit[] }>(`/api/search${query({ q, conversation })}`),
}
