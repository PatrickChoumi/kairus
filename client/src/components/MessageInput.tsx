import { useState, useRef, useCallback } from 'react';
import { getSocket } from '../store/socket';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import type { Message } from '../lib/types';

interface Props { onSend: (content?: string, mediaPath?: string) => void; replyTo: Message | null; onCancelReply: () => void; chatId: string; }

const EMOJIS = ['😊', '😂', '❤️', '🔥', '👍', '😢', '😮', '🎉', '🙏', '💯', '✨', '🎶', '👀', '💪', '🤝', '🌙', '☀️', '⚡', '❄️', '💡'];

export default function MessageInput({ onSend, replyTo, onCancelReply, chatId }: Props) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
    const socket = getSocket();
    if (socket) socket.emit('stop_typing', { chatId });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape' && replyTo) onCancelReply();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    const socket = getSocket();
    if (socket) {
      socket.emit('typing', { chatId });
      if (typingRef.current) clearTimeout(typingRef.current);
      typingRef.current = setTimeout(() => { socket.emit('stop_typing', { chatId }); }, 2000);
    }
  };

  const pickEmoji = (emoji: string) => {
    setText(t => t + emoji);
    setShowEmoji(false);
    inputRef.current?.focus();
  };

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.media.upload(file);
      onSend(undefined, res.path);
    } catch { toast.error('Échec de l\'upload'); } finally { setUploading(false); }
  }, [onSend]);

  const handleVoice = useCallback(async () => {
    if (recording) { setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
        setUploading(true);
        try { const res = await api.media.upload(file); onSend('🎤 Message vocal', res.path); } catch { toast.error('Échec de l\'envoi vocal'); } finally { setUploading(false); }
      };
      mediaRecorder.start();
      setRecording(true);
      setTimeout(() => { if (mediaRecorder.state === 'recording') { mediaRecorder.stop(); setRecording(false); } }, 15000);
    } catch { toast.error('Microphone non accessible'); }
  }, [recording, onSend]);

  return (
    <div className="flex-shrink-0 border-t border-border dark:border-dark-tertiary bg-surface dark:bg-dark-surface">
      {replyTo && (
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-hover dark:bg-dark-tertiary border-b border-border dark:border-dark-tertiary">
          <div className="w-0.5 h-8 bg-accent rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-accent">Réponse à {replyTo.sender_name}</p>
            <p className="text-xs text-text-secondary truncate">{replyTo.content || '📷 Media'}</p>
          </div>
          <button onClick={onCancelReply} className="btn-ghost p-1 rounded" aria-label="Annuler la réponse">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-2.5">
        <label className="btn-ghost p-2 rounded-lg cursor-pointer" aria-label="Joindre un fichier">
          <svg className="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
          <input type="file" className="hidden" onChange={handleFile} accept="image/*,.pdf,.doc,.docx,.txt,.webm" />
        </label>

        <div className="flex-1 relative">
          <input ref={inputRef} type="text" value={text} onChange={handleChange} onKeyDown={handleKeyDown}
            className="w-full px-4 py-2.5 rounded-xl bg-surface-tertiary dark:bg-dark-tertiary text-sm dark:text-white placeholder-text-tertiary outline-none"
            placeholder={uploading ? 'Upload en cours…' : (recording ? 'Enregistrement…' : 'Écrire un message…')} disabled={uploading || recording} />
        </div>

        <div className="relative">
          <button onClick={() => setShowEmoji(!showEmoji)} className="btn-ghost p-2 rounded-lg" aria-label="Emoji">
            <svg className="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
          {showEmoji && (
            <div className="absolute bottom-12 right-0 w-64 bg-surface dark:bg-dark-secondary rounded-2xl shadow-2xl border border-border dark:border-dark-tertiary p-3 z-30">
              <div className="grid grid-cols-5 gap-1">
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => pickEmoji(e)} className="w-10 h-10 flex items-center justify-center hover:bg-surface-hover dark:hover:bg-dark-tertiary rounded-lg text-xl">{e}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button onClick={handleVoice} className={`btn-ghost p-2 rounded-lg ${recording ? 'text-red-500 bg-red-50 dark:bg-red-900/20 animate-pulse' : ''}`} aria-label="Message vocal">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
        </button>

        <button onClick={handleSend} disabled={!text.trim()} className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95" aria-label="Envoyer">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" /></svg>
        </button>
      </div>
    </div>
  );
}
