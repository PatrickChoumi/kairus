import { useState, useMemo } from 'react';
import { useAuthStore } from '../store/auth';
import type { Chat } from '../lib/types';

interface Props {
  chats: Chat[]; activeChat: string | null; onSelect: (id: string) => void;
  onNewChat: () => void; onSettings: () => void; onSearch: () => void; onLogout: () => void;
  sidebarOpen: boolean; showMobileList: boolean;
}

export default function ChatList({ chats, activeChat, onSelect, onNewChat, onSettings, onSearch, onLogout, sidebarOpen, showMobileList }: Props) {
  const { user, onlineUsers } = useAuthStore();
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return chats;
    const q = search.toLowerCase();
    return chats.filter(c => c.title?.toLowerCase().includes(q));
  }, [chats, search]);

  function formatTime(t?: string) {
    if (!t) return '';
    const d = new Date(t + 'Z');
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  const isUserOnline = (uid: string) => onlineUsers.has(uid);

  return (
    <div className={`${sidebarOpen ? 'w-80 min-w-[20rem]' : 'w-0 min-w-0'} ${showMobileList ? 'flex' : 'hidden md:flex'} flex-col border-r border-border dark:border-dark-tertiary bg-surface dark:bg-dark-surface transition-all duration-200 overflow-hidden`}>
      <div className="h-16 flex items-center justify-between px-4 border-b border-border dark:border-dark-tertiary flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold text-sm">K</div>
          <h1 className="font-semibold dark:text-white">Kairus</h1>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onSearch} className="btn-ghost p-2 rounded-lg" aria-label="Rechercher" title="Rechercher (Ctrl+K)">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </button>
          <div className="relative">
            <button onClick={() => setMenu(!menu)} className="btn-ghost p-2 rounded-lg" aria-label="Menu" aria-expanded={menu}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" /></svg>
            </button>
            {menu && <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute right-0 top-10 w-44 bg-surface dark:bg-dark-secondary rounded-xl shadow-xl border border-border dark:border-dark-tertiary z-20 py-1 overflow-hidden">
                <button onClick={() => { onSettings(); setMenu(false); }} className="w-full px-4 py-2.5 text-left hover:bg-surface-hover dark:hover:bg-dark-tertiary text-sm dark:text-white">Paramètres</button>
                <button onClick={() => { setShowLogoutConfirm(true); setMenu(false); }} className="w-full px-4 py-2.5 text-left hover:bg-surface-hover dark:hover:bg-dark-tertiary text-sm text-red-500">Déconnexion</button>
              </div>
            </>}
          </div>
        </div>
      </div>

      <div className="p-3 flex-shrink-0">
        <input className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-tertiary dark:bg-dark-tertiary text-sm placeholder-text-tertiary dark:text-white" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher une conversation" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-text-tertiary text-sm gap-2">
            <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            {search ? 'Aucun résultat' : 'Aucune conversation'}
            {!search && <button onClick={onNewChat} className="text-accent text-xs hover:underline">Nouvelle conversation</button>}
          </div>
        ) : filtered.map(chat => {
          const otherMember = chat.type === 'private' ? chat.members.find(m => m.id !== user?.id) : null;
          const isOnline = otherMember ? isUserOnline(otherMember.id) : false;
          return (
            <button key={chat.id} onClick={() => onSelect(chat.id)} className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover dark:hover:bg-dark-tertiary transition-colors ${activeChat === chat.id ? 'bg-accent-light dark:bg-accent/20' : ''}`} aria-selected={activeChat === chat.id}>
              <div className="relative flex-shrink-0">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-semibold text-sm">{chat.title?.[0]?.toUpperCase() || '?'}</div>
                {isOnline && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-surface dark:border-dark-surface rounded-full" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm dark:text-white truncate">{chat.title}</span>
                  <span className="text-xs text-text-tertiary flex-shrink-0 ml-2">{formatTime(chat.last_message_time)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-text-secondary truncate">{chat.last_message || 'Aucun message'}</span>
                  {chat.unread_count ? <span className="w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">{chat.unread_count > 9 ? '9+' : chat.unread_count}</span> : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="p-3 border-t border-border dark:border-dark-tertiary flex-shrink-0">
        <button onClick={onNewChat} className="btn-primary w-full flex items-center justify-center gap-2 text-sm py-2.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Nouvelle conversation
        </button>
      </div>

      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowLogoutConfirm(false)}>
          <div className="bg-surface dark:bg-dark-secondary rounded-2xl p-6 max-w-xs w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-2 dark:text-white">Déconnexion</h3>
            <p className="text-sm text-text-secondary mb-5">Êtes-vous sûr de vouloir vous déconnecter ?</p>
            <div className="flex gap-3">
              <button onClick={() => setShowLogoutConfirm(false)} className="btn-ghost flex-1 text-sm">Annuler</button>
              <button onClick={onLogout} className="flex-1 px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors">Se déconnecter</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
