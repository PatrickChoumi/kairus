import { useAuthStore } from '../store/auth';

const API_URL = import.meta.env.VITE_API_URL || '';

function headers(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function request<T>(method: string, path: string, body?: any): Promise<T> {
  const opts: RequestInit = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, opts);
  if (res.status === 401) {
    useAuthStore.getState().logout();
    throw new Error('Unauthorized');
  }
  if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error || 'Request failed'); }
  return res.json();
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: any) => request<T>('POST', p, b),
  put: <T>(p: string, b?: any) => request<T>('PUT', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),

  auth: {
    register: (phone: string, password: string, display_name: string) =>
      api.post<{ token: string; refreshToken: string; user: any }>('/api/auth/register', { phone, password, display_name }),
    login: (phone: string, password: string) =>
      api.post<{ token: string; refreshToken: string; user: any }>('/api/auth/login', { phone, password }),
  },

  chats: {
    list: () => api.get<any[]>('/api/chats'),
    get: (id: string) => api.get<any>(`/api/chats/${id}`),
    create: (type: string, userId?: string, title?: string) =>
      api.post<{ chatId: string; needsMembers?: boolean }>('/api/chats', { type, userId, title }),
    addMember: (chatId: string, userId: string) => api.post(`/api/chats/${chatId}/members`, { userId }),
    removeMember: (chatId: string, userId: string) => api.del(`/api/chats/${chatId}/members/${userId}`),
  },

  messages: {
    list: (chatId: string, offset = 0) => api.get<any[]>(`/api/chats/${chatId}/messages?offset=${offset}`),
    send: (chatId: string, content?: string, replyTo?: string, mediaPath?: string) =>
      api.post<any>(`/api/chats/${chatId}/messages`, { content, replyTo, mediaPath }),
    edit: (id: string, content: string) => api.put<any>(`/api/messages/${id}`, { content }),
    delete: (id: string) => api.del(`/api/messages/${id}`),
    search: (q: string, chatId?: string) => api.get<any[]>(`/api/messages/search?q=${encodeURIComponent(q)}${chatId ? `&chatId=${chatId}` : ''}`),
    read: (chatId: string, messageIds: string[]) => api.post(`/api/chats/${chatId}/read`, { messageIds }),
    react: (id: string, emoji: string) => api.post<{ reactions: any[] }>(`/api/messages/${id}/reactions`, { emoji }),
  },

  users: {
    me: () => api.get<any>('/api/users/me'),
    update: (data: any) => api.put<any>('/api/users/me', data),
    search: (q: string) => api.get<any[]>(`/api/users/search?q=${encodeURIComponent(q)}`),
    online: () => api.get<string[]>('/api/users/online'),
  },

  contacts: {
    list: () => api.get<any[]>('/api/contacts'),
    add: (contactId: string, displayName?: string) => api.post('/api/contacts', { contactId, displayName }),
    remove: (id: string) => api.del(`/api/contacts/${id}`),
  },

  media: {
    upload: async (file: File) => {
      const token = useAuthStore.getState().token;
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_URL}/api/media/upload`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
      if (!res.ok) throw new Error('Upload failed');
      return res.json() as Promise<{ path: string; type: string; size: number; name: string }>;
    },
  },
};
