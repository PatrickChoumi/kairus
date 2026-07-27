import { useState } from 'react';
import { User, Chat } from '../store/chat';

interface Props {
  chats: Chat[]; activeChat: string | null; onSelect: (id: string) => void;
  onNewChat: () => void; onSettings: () => void; onLogout: () => void;
  user: User | null; sidebarOpen: boolean; onToggleSidebar: () => void; showMobileList: boolean;
}

export default function ChatList({ chats, activeChat, onSelect, onNewChat, onSettings, onLogout, user, sidebarOpen, onToggleSidebar, showMobileList }: Props) {
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState(false);
  const filtered = chats.filter(c => c.title?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className={`${sidebarOpen ? 'w-80 min-w-[20rem]' : 'w-0 min-w-0'} ${showMobileList ? 'flex' : 'hidden md:flex'} flex-col border-r border-surface-tertiary dark:border-dark-tertiary bg-surface dark:bg-dark-surface transition-all duration-200 overflow-hidden`}>
      <div className="h-14 flex items-center justify-between px-4 border-b border-surface-tertiary dark:border-dark-tertiary shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onToggleSidebar} className="btn-ghost p-2 rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <h1 className="font-semibold text-lg">Kairus</h1>
        </div>
        <div className="relative">
          <button onClick={() => setMenu(!menu)} className="btn-ghost p-2 rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" /></svg>
          </button>
          {menu && <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-dark-secondary rounded-xl shadow-lg border border-surface-tertiary dark:border-dark-tertiary overflow-hidden z-50">
            <button onClick={() => { onSettings(); setMenu(false); }} className="w-full px-4 py-2.5 text-left hover:bg-surface-tertiary dark:hover:bg-dark-tertiary text-sm">Settings</button>
            <button onClick={() => { onLogout(); setMenu(false); }} className="w-full px-4 py-2.5 text-left hover:bg-surface-tertiary dark:hover:bg-dark-tertiary text-sm text-red-400">Sign out</button>
          </div>}
        </div>
      </div>
      <div className="p-2">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-tertiary dark:bg-dark-tertiary text-sm placeholder-text-tertiary" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map(chat => (
          <button key={chat.id} onClick={() => onSelect(chat.id)} className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-tertiary dark:hover:bg-dark-tertiary transition-colors ${activeChat === chat.id ? 'bg-accent-light dark:bg-accent/20' : ''}`}>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-medium text-sm shrink-0">{chat.title?.[0]?.toUpperCase() || '?'}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm truncate">{chat.title}</span>
                {chat.last_message_time && <span className="text-xs text-text-tertiary shrink-0 ml-2">{new Date(chat.last_message_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
              <p className="text-xs text-text-secondary truncate mt-0.5">{chat.last_message || (chat.type === 'group' ? 'Group' : 'No messages yet')}</p>
            </div>
          </button>
        ))}
      </div>
      <div className="p-3 border-t border-surface-tertiary dark:border-dark-tertiary">
        <button onClick={onNewChat} className="btn-primary w-full flex items-center justify-center gap-2 text-sm py-2.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Chat
        </button>
      </div>
    </div>
  );
}
