import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
const API_URL = import.meta.env.VITE_API_URL || '';

export function connectSocket(token: string) {
  if (socket?.connected) return socket;
  socket = io(API_URL || '/', {
    auth: { token },
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function getSocket() { return socket; }
export function disconnectSocket() { socket?.disconnect(); socket = null; }

export function apiUrl(path: string) {
  return `${API_URL}${path}`;
}
