import { useState } from 'react';
import { Message } from '../store/chat';

interface Props { message: Message; isOwn: boolean; chatMembers?: { id: string; display_name: string }[]; }

export default function MessageBubble({ message, isOwn, chatMembers }: Props) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || '');
  const [menu, setMenu] = useState(false);
  const token = localStorage.getItem('kairus_token');

  async function handleEdit() {
    if (!editText.trim()) return;
    await fetch(`/api/messages/${message.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ content: editText }) });
    setEditing(false);
  }

  async function handleDelete() {
    await fetch(`/api/messages/${message.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  }

  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group mb-1`}>
      <div className={`max-w-[70%] ${isOwn ? 'order-1' : 'order-1'}`}>
        {!isOwn && chatMembers && chatMembers.length > 0 && (
          <div className="flex items-center gap-2 mb-0.5 px-1">
            <span className="text-xs font-medium text-text-secondary">{message.sender_name}</span>
          </div>
        )}
        {editing ? (
          <div className="flex gap-2">
            <input className="input text-sm py-2" value={editText} onChange={e => setEditText(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && handleEdit()} />
            <button onClick={handleEdit} className="btn-primary text-sm py-2">Save</button>
            <button onClick={() => setEditing(false)} className="btn-ghost text-sm py-2">Cancel</button>
          </div>
        ) : (
          <div className="relative group/menu">
            <div onClick={() => isOwn && setMenu(!menu)} className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${isOwn ? 'bg-accent text-white rounded-br-md cursor-pointer' : 'bg-tertiary dark:bg-dark-tertiary text-text-primary dark:text-white rounded-bl-md'}`}>
              {message.type === 'image' && message.media_path && <img src={message.media_path} className="max-w-full rounded-lg mb-1 max-h-60 object-cover" alt="" />}
              {message.content && <div className="whitespace-pre-wrap break-words">{message.content}</div>}
              <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <span className={`text-[10px] ${isOwn ? 'text-white/60' : 'text-text-tertiary'}`}>{time}</span>
                {message.edited ? 1 > 0 && <span className={`text-[10px] ${isOwn ? 'text-white/60' : 'text-text-tertiary'}`}>edited</span> : null}
              </div>
            </div>
            {isOwn && menu && <div className="absolute right-0 top-full mt-1 bg-white dark:bg-dark-secondary rounded-xl shadow-lg border border-tertiary dark:border-dark-tertiary overflow-hidden z-50 min-w-[100px]">
              <button onClick={() => { setEditing(true); setMenu(false); }} className="w-full px-3 py-2 text-left hover:bg-tertiary dark:hover:bg-dark-tertiary text-xs">Edit</button>
              <button onClick={() => { handleDelete(); setMenu(false); }} className="w-full px-3 py-2 text-left hover:bg-tertiary dark:hover:bg-dark-tertiary text-xs text-red-400">Delete</button>
            </div>}
          </div>
        )}
      </div>
    </div>
  );
}
