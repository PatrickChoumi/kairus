import { useState, useEffect } from 'react';
import { getSocket, apiUrl } from '../store/socket';

interface Props { onClose: () => void; }

export default function NewChatModal({ onClose }: Props) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [tab, setTab] = useState<'users' | 'group'>('users');
  const [groupName, setGroupName] = useState('');

  useEffect(() => {
    if (search.length < 1) { setUsers([]); return; }
    fetch(apiUrl(`/api/users/search?q=${search}`)).then(r => r.json()).then(setUsers);
  }, [search]);

  function startPrivate(userId: string) {
    getSocket()?.emit('create_chat', { type: 'private', userId });
    onClose();
  }

  function createGroup() {
    if (!groupName.trim()) return;
    getSocket()?.emit('create_chat', { type: 'group', title: groupName });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-dark-secondary rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-tertiary dark:border-dark-tertiary">
          <h2 className="font-semibold">New Chat</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex border-b border-tertiary dark:border-dark-tertiary">
          <button onClick={() => setTab('users')} className={`flex-1 py-3 text-sm font-medium text-center ${tab === 'users' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary'}`}>User</button>
          <button onClick={() => setTab('group')} className={`flex-1 py-3 text-sm font-medium text-center ${tab === 'group' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary'}`}>Group</button>
        </div>
        <div className="p-3">
          {tab === 'users' ? (
            <>
              <input className="input text-sm py-2.5 mb-2" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
              <div className="max-h-64 overflow-y-auto space-y-1">
                {users.map(u => (
                  <button key={u.id} onClick={() => startPrivate(u.id)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-tertiary dark:hover:bg-dark-tertiary transition-colors">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-medium text-xs shrink-0">{u.display_name[0]?.toUpperCase()}</div>
                    <div className="text-left min-w-0">
                      <p className="text-sm font-medium truncate">{u.display_name}</p>
                    </div>
                  </button>
                ))}
                {search.length >= 1 && users.length === 0 && <p className="text-center text-text-tertiary text-sm py-4">No users found</p>}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <input className="input text-sm py-2.5" placeholder="Group name" value={groupName} onChange={e => setGroupName(e.target.value)} />
              <button onClick={createGroup} className="btn-primary w-full" disabled={!groupName.trim()}>Create Group</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
