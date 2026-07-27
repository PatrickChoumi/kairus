import { io, Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || '';
let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socket?.connected) return socket;
  socket = io(API_URL || '/', {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
  return socket;
}

export function getSocket() { return socket; }

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function apiUrl(path: string) {
  return `${API_URL}${path}`;
}
