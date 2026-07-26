import { create } from 'zustand';

interface User { id: string; phone: string; username?: string; display_name: string; avatar?: string; }
interface AuthState {
  token: string | null;
  user: User | null;
  initialized: boolean;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  setInitialized: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('kairus_token'),
  user: JSON.parse(localStorage.getItem('kairus_user') || 'null'),
  initialized: false,
  setAuth: (token, user) => {
    localStorage.setItem('kairus_token', token);
    localStorage.setItem('kairus_user', JSON.stringify(user));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem('kairus_token');
    localStorage.removeItem('kairus_user');
    set({ token: null, user: null });
  },
  setInitialized: () => set({ initialized: true }),
}));
