import { useState } from 'react';
import type { Message } from '../lib/types';

interface Props {
  message: Message; isOwn: boolean; isGroup: boolean;
  onReply: () => void; onReact: (emoji: string) => void;
  onDelete: () => void; onEdit: (content: string) => void;
  isLast?: boolean;
}

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function MessageBubble({ message, isOwn, isGroup, onReply, onReact, onDelete, onEdit, isLast }: Props) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || '');
  const [showReactions, setShowReactions] = useState(false);

  const time = message.created_at
    ? new Date(message.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  function formatReactions() {
    if (!message.reactions?.length) return null;
    const grouped: Record<string, string[]> = {};
    message.reactions.forEach(r => { if (!grouped[r.emoji]) grouped[r.emoji] = []; grouped[r.emoji].push(r.user_id); });
    return Object.entries(grouped).map(([emoji, users]) => ({ emoji, count: users.length }));
  }

  const handleEditSubmit = () => {
    if (editText.trim() && editText !== message.content) onEdit(editText);
    setEditing(false);
  };

  const imgSrc = message.media_path ? (message.media_path.startsWith('http') ? message.media_path : import.meta.env.VITE_API_URL + message.media_path) : null;

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} relative group`}>
      <div className={`max-w-[70%] ${isOwn ? 'order-1' : 'order-1'}`}>
        {isGroup && !isOwn && (
          <p className="text-[11px] text-accent font-medium ml-1 mb-0.5">{message.sender_name}</p>
        )}

        <div className={`relative px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${isOwn ? 'bg-accent text-white rounded-br-md' : 'bg-surface-tertiary dark:bg-dark-tertiary text-text-primary dark:text-white rounded-bl-md'}`}
          onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}>
          {message.replyPreview && (
            <div className={`mb-1.5 pl-2.5 border-l-2 ${isOwn ? 'border-white/50' : 'border-accent'} text-xs opacity-75`}>
              <span className="font-medium">{message.replyPreview.senderName}</span>
              <p className="truncate">{message.replyPreview.content}</p>
            </div>
          )}

          {editing ? (
            <div className="flex gap-2">
              <input className="flex-1 bg-transparent border-b border-white/30 text-sm outline-none" value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleEditSubmit(); if (e.key === 'Escape') setEditing(false); }} autoFocus />
              <button onClick={handleEditSubmit} className="text-xs opacity-75 hover:opacity-100">✓</button>
              <button onClick={() => setEditing(false)} className="text-xs opacity-75 hover:opacity-100">✕</button>
            </div>
          ) : (
            <>
              {imgSrc ? <img src={imgSrc} alt="Media" className="rounded-xl max-w-full max-h-64 object-cover cursor-pointer -mx-1 -mt-1 mb-1" loading="lazy" /> : null}
              {message.content && <span>{message.content}</span>}
              {message.edited ? <span className="text-[10px] opacity-50 ml-1">(modifié)</span> : null}
            </>
          )}

          <div className={`flex items-center gap-1.5 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] opacity-60">{time}</span>
            {isOwn && <span className="text-[10px] opacity-60">{message.readBy?.length ? '✓✓' : '✓'}</span>}
          </div>

          {formatReactions() && (
            <div className={`flex gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
              {formatReactions()!.map(r => (
                <span key={r.emoji} className="text-xs bg-black/10 dark:bg-white/10 rounded-full px-1.5 py-0.5 cursor-pointer hover:bg-black/20 dark:hover:bg-white/20 transition-colors">{r.emoji} {r.count > 1 ? r.count : ''}</span>
              ))}
            </div>
          )}
        </div>

        <div className={`flex gap-1 mt-0.5 ${isOwn ? 'justify-end' : 'justify-start'}`}>
          {showReactions && REACTIONS.map(emoji => (
            <button key={emoji} onClick={() => { onReact(emoji); setShowReactions(false); }} className="text-sm hover:scale-125 transition-transform">{emoji}</button>
          ))}
          {!showReactions && (
            <button onClick={() => setShowReactions(true)} className="text-[10px] text-text-tertiary hover:text-text-secondary transition-colors opacity-0 group-hover:opacity-100">😊</button>
          )}
        </div>

        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className={`absolute ${isOwn ? 'right-0' : 'left-0'} top-full mt-1 w-32 bg-surface dark:bg-dark-secondary rounded-xl shadow-xl border border-border dark:border-dark-tertiary z-20 py-1 overflow-hidden`}>
              <button onClick={() => { onReply(); setMenu(false); }} className="w-full px-3 py-2 text-left hover:bg-surface-hover dark:hover:bg-dark-tertiary text-xs dark:text-white">Répondre</button>
              {isOwn && <button onClick={() => { setEditing(true); setEditText(message.content || ''); setMenu(false); }} className="w-full px-3 py-2 text-left hover:bg-surface-hover dark:hover:bg-dark-tertiary text-xs dark:text-white">Modifier</button>}
              {isOwn && <button onClick={() => { onDelete(); setMenu(false); }} className="w-full px-3 py-2 text-left hover:bg-surface-hover dark:hover:bg-dark-tertiary text-xs text-red-500">Supprimer</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
