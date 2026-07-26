import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { connectSocket } from './store/socket';
import LoginPage from './pages/LoginPage';
import ChatPage from './pages/ChatPage';

export default function App() {
  const { token, setInitialized, initialized } = useAuthStore();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', localStorage.getItem('kairus_dark') === 'true');
    setInitialized();
  }, []);

  useEffect(() => { if (token) connectSocket(token); }, [token]);

  if (!initialized) return null;

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/*" element={token ? <ChatPage /> : <Navigate to="/login" />} />
    </Routes>
  );
}
