import { useState, useRef, FormEvent, KeyboardEvent } from 'react';
import { getSocket, apiUrl } from '../store/socket';
import { useAuthStore } from '../store/auth';
import StickerPicker from './StickerPicker';

interface Props { chatId: string; }

export default function MessageInput({ chatId }: Props) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [showStickers, setShowStickers] = useState(false);
  const { token } = useAuthStore();
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>();

  function emitTyping() {
    getSocket()?.emit('typing', { chatId });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => getSocket()?.emit('stop_typing', { chatId }), 2000);
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim() && !file) return;

    const body: any = { content: text || null };
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      const up = await (await fetch(apiUrl('/api/media/upload'), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
      body.mediaPath = up.path;
      body.mediaType = up.type;
    }

    await fetch(apiUrl(`/api/chats/${chatId}/messages`), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    setText('');
    setFile(null);
    getSocket()?.emit('stop_typing', { chatId });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 border-t border-surface-tertiary dark:border-dark-tertiary">
      {file && <div className="mb-2 flex items-center gap-2 text-sm text-text-secondary">
        <span className="truncate max-w-[200px]">{file.name}</span>
        <button type="button" onClick={() => setFile(null)} className="text-red-400 hover:text-red-300">x</button>
      </div>}
      <div className="flex items-end gap-2">
        <label className="btn-ghost p-2.5 rounded-xl cursor-pointer shrink-0">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
          <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>
        <div className="relative">
          <button type="button" onClick={() => setShowStickers(!showStickers)} className="btn-ghost p-2.5 rounded-xl shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
          {showStickers && <StickerPicker onSelect={(emoji) => { setText(t => t + emoji); setShowStickers(false); }} onClose={() => setShowStickers(false)} />}
        </div>
        <input className="input text-sm py-2.5 flex-1" placeholder="Message..." value={text}
          onChange={e => { setText(e.target.value); emitTyping(); }} onKeyDown={onKey} />
        <button type="submit" className="btn-primary p-2.5 rounded-xl shrink-0" disabled={!text.trim() && !file}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
        </button>
      </div>
    </form>
  );
}
