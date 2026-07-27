import { Component, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { connectSocket, disconnectSocket, getSocket } from './store/socket';
import { useChatStore } from './store/chat';
import { api } from './lib/api';
import LoginPage from './pages/LoginPage';
import ChatPage from './pages/ChatPage';
import ToastContainer from './components/ToastContainer';

class ErrorBoundary extends Component<{ children: any }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return <div className="h-screen flex items-center justify-center bg-surface dark:bg-dark-bg text-text-primary p-8 text-center">
        <div><h1 className="text-xl font-semibold mb-2">Une erreur est survenue</h1>
        <p className="text-text-secondary text-sm mb-4">{this.state.error.message}</p>
        <button onClick={() => { this.setState({ error: null }); window.location.href = '/'; }} className="btn-primary">Recharger</button></div>
      </div>;
    }
    return this.props.children;
  }
}

function SocketHandler() {
  const { token, setOnlineUsers, addOnlineUser, removeOnlineUser, setSocketStatus } = useAuthStore();
  const { addMessage, editMessage, deleteMessage, addChat, setTyping, clearTyping, updateReactions, setChats } = useChatStore();

  useEffect(() => {
    if (!token) { disconnectSocket(); return; }
    const socket = connectSocket(token);
    setSocketStatus('disconnected');

    socket.on('connect', () => { setSocketStatus('connected'); api.users.online().then(setOnlineUsers).catch(() => {}); });
    socket.on('disconnect', () => { setSocketStatus('disconnected'); });
    socket.on('reconnecting', () => { setSocketStatus('reconnecting'); });

    socket.on('new_message', (msg: any) => addMessage(msg));
    socket.on('edit_message', (msg: any) => editMessage(msg));
    socket.on('delete_message', ({ id, chat_id }: any) => deleteMessage(id, chat_id));
    socket.on('chat_created', ({ chatId }: any) => { api.chats.list().then(setChats).catch(() => {}); });
    socket.on('member_added', () => { api.chats.list().then(setChats).catch(() => {}); });
    socket.on('member_removed', () => { api.chats.list().then(setChats).catch(() => {}); });
    socket.on('typing', ({ userId, displayName, chatId }: any) => setTyping(chatId, userId, displayName));
    socket.on('stop_typing', ({ userId, chatId }: any) => clearTyping(chatId, userId));
    socket.on('user_online', ({ userId }: any) => addOnlineUser(userId));
    socket.on('user_offline', ({ userId }: any) => removeOnlineUser(userId));
    socket.on('reaction_updated', ({ messageId, reactions }: any) => updateReactions(messageId, reactions));

    return () => { disconnectSocket(); };
  }, [token]);

  return null;
}

export default function App() {
  const { token, setInitialized, initialized } = useAuthStore();

  useEffect(() => {
    const isDark = localStorage.getItem('kairus_dark') === 'true';
    document.documentElement.classList.toggle('dark', isDark);
    setInitialized();
  }, []);

  if (!initialized) return null;

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/" /> : <LoginPage />} />
        <Route path="/*" element={token ? <><SocketHandler /><ChatPage /></> : <Navigate to="/login" />} />
      </Routes>
      <ToastContainer />
    </ErrorBoundary>
  );
}
