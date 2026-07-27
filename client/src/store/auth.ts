import { create } from 'zustand';

export interface User { id: string; phone: string; username?: string; display_name: string; avatar?: string; }

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  initialized: boolean;
  onlineUsers: Set<string>;
  socketStatus: 'connected' | 'disconnected' | 'reconnecting';
  setAuth: (token: string, refreshToken: string, user: User) => void;
  setToken: (token: string) => void;
  logout: () => void;
  setInitialized: () => void;
  setOnlineUsers: (ids: string[]) => void;
  addOnlineUser: (id: string) => void;
  removeOnlineUser: (id: string) => void;
  setSocketStatus: (s: 'connected' | 'disconnected' | 'reconnecting') => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('kairus_token'),
  refreshToken: localStorage.getItem('kairus_refresh'),
  user: JSON.parse(localStorage.getItem('kairus_user') || 'null'),
  initialized: false,
  onlineUsers: new Set(),
  socketStatus: 'disconnected',

  setAuth: (token, refreshToken, user) => {
    localStorage.setItem('kairus_token', token);
    localStorage.setItem('kairus_refresh', refreshToken);
    localStorage.setItem('kairus_user', JSON.stringify(user));
    set({ token, refreshToken, user });
  },

  setToken: (token) => {
    localStorage.setItem('kairus_token', token);
    set({ token });
  },

  logout: () => {
    localStorage.removeItem('kairus_token');
    localStorage.removeItem('kairus_refresh');
    localStorage.removeItem('kairus_user');
    set({ token: null, refreshToken: null, user: null, onlineUsers: new Set() });
  },

  setInitialized: () => set({ initialized: true }),
  setOnlineUsers: (ids) => set({ onlineUsers: new Set(ids) }),
  addOnlineUser: (id) => set(s => { const next = new Set(s.onlineUsers); next.add(id); return { onlineUsers: next }; }),
  removeOnlineUser: (id) => set(s => { const next = new Set(s.onlineUsers); next.delete(id); return { onlineUsers: next }; }),
  setSocketStatus: (socketStatus) => set({ socketStatus }),
}));
