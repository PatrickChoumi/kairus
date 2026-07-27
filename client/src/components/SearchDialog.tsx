import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api';

interface Props { onClose: () => void; onSelectChat: (chatId: string) => void; }

export default function SearchDialog({ onClose, onSelectChat }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { inputRef.current?.focus(); }, []);

  function handleChange(q: string) {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try { setResults(await api.messages.search(q)); } catch {} finally { setLoading(false); }
    }, 400);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface dark:bg-dark-secondary rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-4 pb-2">
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input ref={inputRef} className="w-full pl-10 pr-4 py-3 rounded-xl bg-surface-tertiary dark:bg-dark-tertiary text-sm dark:text-white outline-none" placeholder="Rechercher dans les messages… (min 2 caractères)" value={query} onChange={e => handleChange(e.target.value)} aria-label="Rechercher dans les messages" />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto px-2 pb-2">
          {loading && <p className="text-center text-sm text-text-secondary py-4">Recherche…</p>}
          {!loading && results.length === 0 && query.length >= 2 && <p className="text-center text-sm text-text-tertiary py-4">Aucun résultat</p>}
          {results.map(msg => (
            <button key={msg.id} onClick={() => onSelectChat(msg.chat_id)} className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-hover dark:hover:bg-dark-tertiary transition-colors text-left">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0 mt-0.5">{msg.chat_title?.[0]?.toUpperCase() || '?'}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-accent">{msg.sender_name}</span>
                  <span className="text-[10px] text-text-tertiary">dans {msg.chat_title}</span>
                </div>
                <p className="text-sm dark:text-white truncate">{msg.content}</p>
              </div>
            </button>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-border dark:border-dark-tertiary">
          <p className="text-[10px] text-text-tertiary text-center">Appuyez sur <kbd className="px-1 py-0.5 bg-surface-tertiary dark:bg-dark-tertiary rounded text-[10px] font-mono">Esc</kbd> pour fermer</p>
        </div>
      </div>
    </div>
  );
}
