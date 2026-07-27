import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { getSocket } from '../store/socket';
import { api } from '../lib/api';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import type { Chat, Message } from '../lib/types';

interface Props { chat: Chat | undefined; onBack: () => void; onProfile: (id: string, name: string, avatar?: string) => void; }

export default function ChatWindow({ chat, onBack, onProfile }: Props) {
  const { user, onlineUsers } = useAuthStore();
  const { messages, setMessages, loading, setLoading, typingUsers, clearUnread } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [inCall, setInCall] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const lvRef = useRef<HTMLVideoElement>(null);
  const rvRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const chatId = chat?.id;
  const chatMsgs = chatId ? messages[chatId] || [] : [];
  const isOnline = chat?.type === 'private' && chat.members.length > 0
    ? onlineUsers.has(chat.members.find(m => m.id !== user?.id)?.id || '')
    : false;

  useEffect(() => { if (chatId) clearUnread(chatId); }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMsgs.length]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
  }, []);

  const loadOlder = useCallback(async () => {
    if (!chatId || loading) return;
    setLoading(true);
    try {
      const older = await api.messages.list(chatId, chatMsgs.length);
      if (older.length) {
        const { appendMessages } = useChatStore.getState();
        appendMessages(chatId, older);
      }
    } catch {} finally { setLoading(false); }
  }, [chatId, chatMsgs.length]);

  const handleReact = useCallback(async (msgId: string, emoji: string) => {
    try { await api.messages.react(msgId, emoji); } catch {}
  }, []);

  const handleDelete = useCallback(async (msgId: string) => {
    if (!chatId) return;
    try { await api.messages.delete(msgId); } catch {}
  }, [chatId]);

  const handleEdit = useCallback(async (msgId: string, content: string) => {
    try { await api.messages.edit(msgId, content); } catch {}
  }, []);

  const handleSend = useCallback(async (content?: string, mediaPath?: string) => {
    if (!chatId || (!content && !mediaPath)) return;
    try { await api.messages.send(chatId, content, replyTo?.id, mediaPath); setReplyTo(null); } catch {}
  }, [chatId, replyTo]);

  // WebRTC
  const startCall = useCallback(async (type: 'audio' | 'video') => {
    if (!chat || chat.type !== 'private') return;
    setCallType(type);
    setInCall(true);
    const socket = getSocket();
    if (!socket) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      if (lvRef.current) lvRef.current.srcObject = stream;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      pc.ontrack = (e) => { setRemoteStream(e.streams[0]); if (rvRef.current) rvRef.current.srcObject = e.streams[0]; };
      pc.onicecandidate = (e) => { if (e.candidate) socket.emit('webrtc_ice', { to: chat.members.find(m => m.id !== user?.id)?.id, candidate: e.candidate }); };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc_offer', { to: chat.members.find(m => m.id !== user?.id)?.id, offer });
      pcRef.current = pc;
    } catch { setInCall(false); }
  }, [chat, user]);

  const endCall = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    lvRef.current?.srcObject && (lvRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    rvRef.current?.srcObject && (rvRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    setRemoteStream(null);
    setInCall(false);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !chat || chat.type !== 'private') return;
    const otherId = chat.members.find(m => m.id !== user?.id)?.id;
    if (!otherId) return;

    const onOffer = async ({ from, offer }: any) => {
      if (from !== otherId) return;
      setCallType(offer.sdp?.includes('m=video') ? 'video' : 'audio');
      setInCall(true);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (lvRef.current) lvRef.current.srcObject = stream;
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
        pc.ontrack = (e) => { setRemoteStream(e.streams[0]); if (rvRef.current) rvRef.current.srcObject = e.streams[0]; };
        pc.onicecandidate = (e) => { if (e.candidate) socket.emit('webrtc_ice', { to: from, candidate: e.candidate }); };
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc_answer', { to: from, answer });
        pcRef.current = pc;
      } catch { setInCall(false); }
    };

    const onAnswer = async ({ from, answer }: any) => {
      if (from !== otherId || !pcRef.current) return;
      try { await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer)); } catch {}
    };

    const onIce = async ({ from, candidate }: any) => {
      if (from !== otherId || !pcRef.current) return;
      try { await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    };

    socket.on('webrtc_offer', onOffer);
    socket.on('webrtc_answer', onAnswer);
    socket.on('webrtc_ice', onIce);
    return () => { socket.off('webrtc_offer', onOffer); socket.off('webrtc_answer', onAnswer); socket.off('webrtc_ice', onIce); };
  }, [chat, user]);

  if (!chat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface dark:bg-dark-bg">
        <div className="text-center">
          <div className="w-20 h-20 rounded-3xl bg-surface-tertiary dark:bg-dark-tertiary flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          </div>
          <h2 className="text-lg font-semibold dark:text-white">Kairus</h2>
          <p className="text-sm text-text-secondary mt-1">Sélectionnez une conversation</p>
          <div className="flex gap-4 mt-4 text-xs text-text-tertiary justify-center">
            <span><kbd className="px-1.5 py-0.5 bg-surface-hover dark:bg-dark-tertiary rounded text-[10px] font-mono">⌘K</kbd> Rechercher</span>
          </div>
        </div>
      </div>
    );
  }

  const typingList = typingUsers[chat.id] || [];

  return (
    <div className="flex-1 flex flex-col bg-surface dark:bg-dark-bg min-w-0 relative">
      <div className="h-16 flex items-center justify-between px-4 border-b border-border dark:border-dark-tertiary bg-surface dark:bg-dark-surface flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="btn-ghost p-2 rounded-lg md:hidden" aria-label="Retour">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={() => onProfile(chat.id, chat.title || '', chat.avatar)} className="flex items-center gap-3 min-w-0 text-left" aria-label="Voir le profil">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-semibold text-sm">{chat.title?.[0]?.toUpperCase() || '?'}</div>
              {isOnline && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-surface dark:border-dark-surface rounded-full" />}
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-sm dark:text-white truncate">{chat.title}</h2>
              <p className="text-xs text-text-secondary">{typingList.length ? typingList.map(t => t.displayName).join(', ') + ' écrit…' : (isOnline ? 'En ligne' : 'Hors ligne')}</p>
            </div>
          </button>
        </div>
        <div className="flex items-center gap-1">
          {chat.type === 'private' && (
            <>
              <button onClick={() => startCall('audio')} className="btn-ghost p-2 rounded-lg" aria-label="Appel audio" title="Appel audio">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
              </button>
              <button onClick={() => startCall('video')} className="btn-ghost p-2 rounded-lg" aria-label="Appel vidéo" title="Appel vidéo">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              </button>
            </>
          )}
          <button onClick={() => onProfile(chat.id, chat.title || '', chat.avatar)} className="btn-ghost p-2 rounded-lg" aria-label="Informations">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
        </div>
      </div>

      {inCall && (
        <div className="absolute inset-0 z-40 bg-black flex flex-col">
          <div className="flex-1 flex relative">
            {remoteStream && <video ref={rvRef} autoPlay playsInline className="flex-1 object-cover" />}
            <video ref={lvRef} autoPlay muted playsInline className={`absolute ${remoteStream ? 'top-4 right-4 w-32 h-44 rounded-2xl object-cover shadow-xl' : 'inset-0 object-cover'}`} />
          </div>
          <div className="h-20 flex items-center justify-center gap-6 bg-black/50">
            <button onClick={endCall} className="w-14 h-14 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-all active:scale-95">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.516l2.257-1.13a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.28 3H5z" /></svg>
            </button>
          </div>
        </div>
      )}

      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1" onScroll={handleScroll} role="log" aria-label="Messages" aria-live="polite">
        {chatMsgs.length > 30 && (
          <button onClick={loadOlder} disabled={loading} className="w-full text-center text-xs text-accent py-2 hover:underline">
            {loading ? 'Chargement…' : 'Charger les messages précédents'}
          </button>
        )}

        {chatMsgs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-tertiary text-sm gap-2">
            <span className="text-3xl">💬</span>
            <p>Aucun message. Commencez la conversation !</p>
          </div>
        )}

        {chatMsgs.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOwn={msg.sender_id === user?.id}
            isGroup={chat.type === 'group'}
            onReply={() => setReplyTo(msg)}
            onReact={(emoji) => handleReact(msg.id, emoji)}
            onDelete={() => handleDelete(msg.id)}
            onEdit={(content) => handleEdit(msg.id, content)}
            isLast={i === chatMsgs.length - 1}
          />
        ))}
        {showScrollBtn && (
          <button onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })} className="sticky bottom-2 left-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-accent text-white shadow-lg flex items-center justify-center hover:bg-accent-hover transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
          </button>
        )}
        <div ref={messagesEndRef} />
      </div>

      <MessageInput
        onSend={handleSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        chatId={chat.id}
      />
    </div>
  );
}
