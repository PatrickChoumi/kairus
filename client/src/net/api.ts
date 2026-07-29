import type { Conversation, Message, SearchHit, User } from './types'

/** Empty in production: the server serves the client from the same origin. */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export const apiUrl = (path: string) => `${BASE}${path}`

export const socketUrl = (): string => {
  if (BASE) return BASE.replace(/^http/, 'ws') + '/socket'
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/socket`
}

export class ApiError extends Error {}

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
    const message = typeof payload.error === 'string' ? payload.error : 'quelque chose n’a pas fonctionné'
    throw new ApiError(message)
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
    request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ handle, name, password }),
    }),

  login: (handle: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ handle, password }),
    }),

  me: () => request<{ user: User }>('/api/me'),

  openConversation: (handle: string) =>
    request<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    }),

  messages: (conversation: string, before?: number) =>
    request<{ messages: Message[] }>(`/api/messages${query({ conversation, before })}`),

  people: (q: string) => request<{ people: User[] }>(`/api/people${query({ q })}`),

  search: (q: string) => request<{ hits: SearchHit[] }>(`/api/search${query({ q })}`),
}
