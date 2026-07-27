import { useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore } from '../store/chat';
import { useAuthStore } from '../store/auth';
import { getSocket, apiUrl } from '../store/socket';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';

interface Props { chatId: string | null; onBack: () => void; showMobileList: boolean; }

export default function ChatWindow({ chatId, onBack, showMobileList }: Props) {
  const { chats, messages, setMessages, getChat } = useChatStore();
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [inCall, setInCall] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const lvRef = useRef<HTMLVideoElement>(null);
  const rvRef = useRef<HTMLVideoElement>(null);

  const { user } = useAuthStore();
  const chat = chats.find(c => c.id === chatId);
  const msgs = chatId ? (messages[chatId] || []) : [];

  useEffect(() => {
    if (!chatId) return;
    setLoading(true);
    fetch(apiUrl(`/api/chats/${chatId}/messages`)).then(r => r.json()).then(m => { setMessages(chatId, m); setLoading(false); });
  }, [chatId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onTyping = ({ chatId: cid, displayName }: any) => { if (cid === chatId) setTyping(p => p.includes(displayName) ? p : [...p, displayName]); };
    const offTyping = ({ chatId: cid }: any) => { if (cid === chatId) setTyping([]); };
    s.on('typing', onTyping);
    s.on('stop_typing', offTyping);
    return () => { s.off('typing', onTyping); s.off('stop_typing', offTyping); };
  }, [chatId]);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onOffer = async ({ from, offer }: any) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      setLocalStream(stream);
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      pc.ontrack = (e) => setRemoteStream(e.streams[0]);
      pc.onicecandidate = (e) => e.candidate && s.emit('webrtc_ice', { to: from, candidate: e.candidate });
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      s.emit('webrtc_answer', { to: from, answer });
      setInCall(true);
    };
    const onAnswer = async ({ answer }: any) => { await pcRef.current?.setRemoteDescription(new RTCSessionDescription(answer)); };
    const onIce = async ({ candidate }: any) => { await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidate)); };
    s.on('webrtc_offer', onOffer);
    s.on('webrtc_answer', onAnswer);
    s.on('webrtc_ice', onIce);
    return () => { s.off('webrtc_offer', onOffer); s.off('webrtc_answer', onAnswer); s.off('webrtc_ice', onIce); };
  }, []);

  const startCall = useCallback(async () => {
    if (!chat) return;
    const partnerId = chat.members.find(m => m.id !== chat.created_by)?.id || chat.members[0]?.id;
    if (!partnerId) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    setLocalStream(stream);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRef.current = pc;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.ontrack = (e) => setRemoteStream(e.streams[0]);
    pc.onicecandidate = (e) => e.candidate && getSocket()?.emit('webrtc_ice', { to: partnerId, candidate: e.candidate });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    getSocket()?.emit('webrtc_offer', { to: partnerId, offer });
    setInCall(true);
  }, [chat]);

  const endCall = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach(t => t.stop());
    setLocalStream(null); setRemoteStream(null); setInCall(false);
  }, [localStream]);

  useEffect(() => { if (lvRef.current && localStream) lvRef.current.srcObject = localStream; if (rvRef.current && remoteStream) rvRef.current.srcObject = remoteStream; }, [localStream, remoteStream]);

  if (!chatId || !chat) return (
    <div className={`flex-1 flex items-center justify-center ${showMobileList ? 'hidden md:flex' : 'flex'}`}>
      <div className="text-center">
        <div className="w-16 h-16 bg-surface-tertiary dark:bg-dark-tertiary rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
        </div>
        <p className="text-text-secondary text-sm">Select a conversation</p>
      </div>
    </div>
  );

  return (
    <div className={`flex-1 flex flex-col ${showMobileList ? 'hidden md:flex' : 'flex'}`}>
      <div className="h-14 flex items-center gap-3 px-4 border-b border-surface-tertiary dark:border-dark-tertiary shrink-0">
        <button onClick={onBack} className="btn-ghost p-2 rounded-lg md:hidden">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-medium text-xs shrink-0">{chat.title?.[0]?.toUpperCase() || '?'}</div>
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm block truncate">{chat.title}</span>
        </div>
        {chat.type === 'private' && (
          <button onClick={startCall} className="btn-ghost p-2 rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {loading && <p className="text-center text-text-tertiary text-sm py-8">Loading...</p>}
        {msgs.map(msg => (
          <MessageBubble key={msg.id} message={msg} isOwn={msg.sender_id === user?.id} chatMembers={chat.members} />
        ))}
        {typing.length > 0 && <div className="text-xs text-text-tertiary italic px-3 py-1">{typing.join(', ')} typing...</div>}
        <div ref={bottomRef} />
      </div>
      <MessageInput chatId={chatId} />
      {inCall && <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center">
        <div className="flex gap-4 mb-8">
          <video ref={lvRef} autoPlay muted playsInline className="w-40 h-56 rounded-2xl bg-dark-tertiary object-cover mirror" />
          <video ref={rvRef} autoPlay playsInline className="w-60 h-56 rounded-2xl bg-dark-tertiary object-cover" />
        </div>
        <button onClick={endCall} className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" /></svg>
        </button>
      </div>}
    </div>
  );
}
