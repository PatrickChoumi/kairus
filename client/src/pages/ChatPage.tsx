import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { getSocket } from '../store/socket';
import { api } from '../lib/api';
import ChatList from '../components/ChatList';
import ChatWindow from '../components/ChatWindow';
import NewChatModal from '../components/NewChatModal';
import SettingsPanel from '../components/SettingsPanel';
import SearchDialog from '../components/SearchDialog';
import ProfileModal from '../components/ProfileModal';

export default function ChatPage() {
  const { token, user, logout, socketStatus } = useAuthStore();
  const { chats, setChats, activeChat, setActiveChat, setMessages } = useChatStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showMobileList, setShowMobileList] = useState(true);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showProfile, setShowProfile] = useState<{ id: string; name: string; avatar?: string } | null>(null);

  const loadChats = useCallback(async () => {
    try { const c = await api.chats.list(); setChats(c); } catch {}
  }, []);

  useEffect(() => { loadChats(); }, []);

  const selectChat = useCallback(async (chatId: string) => {
    setActiveChat(chatId);
    setShowMobileList(false);
    setSidebarOpen(false);
    if (window.innerWidth <= 768) setSidebarOpen(false);
    try {
      const msgs = await api.messages.list(chatId);
      setMessages(chatId, msgs);
      const unreadIds = msgs.filter((m: any) => m.sender_id !== user?.id).map((m: any) => m.id);
      if (unreadIds.length) api.messages.read(chatId, unreadIds).catch(() => {});
    } catch {}
  }, [user]);

  const handleBack = () => { setActiveChat(null); setShowMobileList(true); setSidebarOpen(true); };

  const handleNewChat = () => { setShowNewChat(true); };
  const handleSettings = () => { setShowSettings(true); };
  const handleSearch = () => { setShowSearch(true); };
  const handleProfile = (id: string, name: string, avatar?: string) => { setShowProfile({ id, name, avatar }); };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const activeChatData = chats.find(c => c.id === activeChat);

  return (
    <div className="h-screen flex overflow-hidden bg-surface dark:bg-dark-bg">
      {socketStatus === 'disconnected' && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-white text-xs text-center py-1 font-medium" role="alert">
          Reconnexion…
        </div>
      )}

      <ChatList
        chats={chats}
        activeChat={activeChat}
        onSelect={selectChat}
        onNewChat={handleNewChat}
        onSettings={handleSettings}
        onSearch={handleSearch}
        onLogout={logout}
        sidebarOpen={sidebarOpen}
        showMobileList={showMobileList}
      />

      <ChatWindow
        chat={activeChatData}
        onBack={handleBack}
        onProfile={handleProfile}
      />

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} onCreated={(id) => { setShowNewChat(false); selectChat(id); }} />}
      {showSettings && <SettingsPanel user={user} onClose={() => setShowSettings(false)} />}
      {showSearch && <SearchDialog onClose={() => setShowSearch(false)} onSelectChat={selectChat} />}
      {showProfile && <ProfileModal userId={showProfile.id} name={showProfile.name} avatar={showProfile.avatar} onClose={() => setShowProfile(null)} />}
    </div>
  );
}
