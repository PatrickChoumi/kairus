import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { getSocket, disconnectSocket } from '../store/socket';
import ChatList from '../components/ChatList';
import ChatWindow from '../components/ChatWindow';
import NewChatModal from '../components/NewChatModal';
import SettingsPanel from '../components/SettingsPanel';

export default function ChatPage() {
  const { user, logout } = useAuthStore();
  const { chats, setChats, addMessage, editMessage, deleteMessage, setActiveChat, activeChat } = useChatStore();
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileList, setMobileList] = useState(true);

  useEffect(() => {
    fetch('/api/chats').then(r => r.json()).then(setChats);
  }, []);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    s.on('new_message', addMessage);
    s.on('edit_message', editMessage);
    s.on('delete_message', ({ id, chat_id }) => deleteMessage(id, chat_id));
    s.on('chat_created', () => fetch('/api/chats').then(r => r.json()).then(setChats));
    return () => { s.off('new_message'); s.off('edit_message'); s.off('delete_message'); s.off('chat_created'); };
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-surface dark:bg-dark-bg">
      <ChatList chats={chats} activeChat={activeChat} onSelect={(id) => { setActiveChat(id); setMobileList(false); }}
        onNewChat={() => setShowNew(true)} onSettings={() => setShowSettings(true)}
        onLogout={() => { disconnectSocket(); logout(); }} user={user}
        sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        showMobileList={mobileList} />
      <ChatWindow chatId={activeChat} onBack={() => setMobileList(true)} showMobileList={mobileList} />
      {showNew && <NewChatModal onClose={() => setShowNew(false)} />}
      {showSettings && <SettingsPanel user={user} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
