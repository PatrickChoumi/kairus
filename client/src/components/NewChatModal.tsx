import { useState } from 'react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';

interface Props { onClose: () => void; onCreated: (chatId: string) => void; }

export default function NewChatModal({ onClose, onCreated }: Props) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleSearch(q: string) {
    setSearch(q);
    if (q.trim().length < 2) { setUsers([]); return; }
    setLoading(true);
    try { setUsers(await api.users.search(q)); } catch {} finally { setLoading(false); }
  }

  async function startPrivate(userId: string) {
    setCreating(true);
    try {
      const res = await api.chats.create('private', userId);
      onCreated(res.chatId);
      toast.success('Conversation créée');
    } catch { toast.error('Erreur lors de la création'); } finally { setCreating(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[8vh]" onClick={onClose}>
      <div className="w-full max-w-md bg-surface dark:bg-dark-secondary rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-dark-tertiary">
          <h2 className="font-semibold dark:text-white">Nouvelle conversation</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-4">
          <input className="w-full px-4 py-2.5 rounded-xl bg-surface-tertiary dark:bg-dark-tertiary text-sm dark:text-white placeholder-text-tertiary outline-none" placeholder="Rechercher un utilisateur…" value={search} onChange={e => handleSearch(e.target.value)} autoFocus aria-label="Rechercher un utilisateur" />
        </div>
        <div className="max-h-64 overflow-y-auto px-2 pb-2">
          {loading && <p className="text-center text-sm text-text-secondary py-4">Recherche…</p>}
          {!loading && users.length === 0 && search.length >= 2 && <p className="text-center text-sm text-text-tertiary py-4">Aucun utilisateur trouvé</p>}
          {users.map(u => (
            <button key={u.id} onClick={() => startPrivate(u.id)} disabled={creating} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-hover dark:hover:bg-dark-tertiary transition-colors">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-semibold text-sm">{u.display_name?.[0]?.toUpperCase() || '?'}</div>
              <div className="text-left">
                <p className="text-sm font-medium dark:text-white">{u.display_name}</p>
                <p className="text-xs text-text-secondary">{u.username ? `@${u.username}` : u.phone}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
