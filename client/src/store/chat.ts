import { create } from 'zustand';
import type { User, Message, Chat } from '../lib/types';

interface ChatState {
  chats: Chat[];
  messages: Record<string, Message[]>;
  activeChat: string | null;
  loading: boolean;
  typingUsers: Record<string, { userId: string; displayName: string }[]>;
  setChats: (chats: Chat[]) => void;
  setMessages: (chatId: string, messages: Message[]) => void;
  appendMessages: (chatId: string, messages: Message[]) => void;
  addMessage: (message: Message) => void;
  editMessage: (message: Message) => void;
  deleteMessage: (id: string, chatId: string) => void;
  setActiveChat: (chatId: string | null) => void;
  addChat: (chat: Chat) => void;
  getChat: (chatId: string) => Chat | undefined;
  setLoading: (loading: boolean) => void;
  setTyping: (chatId: string, userId: string, displayName: string) => void;
  clearTyping: (chatId: string, userId: string) => void;
  updateReactions: (messageId: string, reactions: { emoji: string; user_id: string }[]) => void;
  addReadReceipt: (messageId: string, userId: string) => void;
  clearUnread: (chatId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  messages: {},
  activeChat: null,
  loading: false,
  typingUsers: {},

  setChats: (chats) => set({ chats }),
  setMessages: (chatId, messages) => set(s => ({ messages: { ...s.messages, [chatId]: messages } })),
  appendMessages: (chatId, messages) => set(s => {
    const existing = s.messages[chatId] || [];
    const existingIds = new Set(existing.map(m => m.id));
    const newMsgs = messages.filter(m => !existingIds.has(m.id));
    return { messages: { ...s.messages, [chatId]: [...newMsgs, ...existing] } };
  }),

  addMessage: (message) => set(s => {
    const msgs = s.messages[message.chat_id] || [];
    if (msgs.find(m => m.id === message.id)) return s;
    return {
      messages: { ...s.messages, [message.chat_id]: [...msgs, message] },
      chats: s.chats.map(c => c.id === message.chat_id ? { ...c, last_message: message.content, last_message_time: message.created_at } : c),
    };
  }),

  editMessage: (message) => set(s => ({
    messages: { ...s.messages, [message.chat_id]: (s.messages[message.chat_id] || []).map(m => m.id === message.id ? message : m) },
  })),

  deleteMessage: (id, chatId) => set(s => ({
    messages: { ...s.messages, [chatId]: (s.messages[chatId] || []).filter(m => m.id !== id) },
  })),

  setActiveChat: (chatId) => set({ activeChat: chatId }),
  addChat: (chat) => set(s => s.chats.find(c => c.id === chat.id) ? s : { chats: [chat, ...s.chats] }),
  getChat: (chatId) => get().chats.find(c => c.id === chatId),
  setLoading: (loading) => set({ loading }),

  setTyping: (chatId, userId, displayName) => set(s => {
    const users = s.typingUsers[chatId] || [];
    if (users.find(u => u.userId === userId)) return s;
    return { typingUsers: { ...s.typingUsers, [chatId]: [...users, { userId, displayName }] } };
  }),

  clearTyping: (chatId, userId) => set(s => {
    const users = (s.typingUsers[chatId] || []).filter(u => u.userId !== userId);
    return { typingUsers: { ...s.typingUsers, [chatId]: users } };
  }),

  updateReactions: (messageId, reactions) => set(s => {
    const updated: Record<string, Message[]> = {};
    for (const [chatId, msgs] of Object.entries(s.messages)) {
      const idx = msgs.findIndex(m => m.id === messageId);
      if (idx !== -1) {
        updated[chatId] = [...msgs];
        updated[chatId][idx] = { ...updated[chatId][idx], reactions };
        break;
      }
    }
    return Object.keys(updated).length ? { messages: { ...s.messages, ...updated } } : s;
  }),

  addReadReceipt: (messageId, userId) => set(s => {
    const updated: Record<string, Message[]> = {};
    for (const [chatId, msgs] of Object.entries(s.messages)) {
      const idx = msgs.findIndex(m => m.id === messageId);
      if (idx !== -1) {
        updated[chatId] = [...msgs];
        const m = { ...updated[chatId][idx] };
        m.readBy = [...(m.readBy || []), userId];
        updated[chatId][idx] = m;
        break;
      }
    }
    return Object.keys(updated).length ? { messages: { ...s.messages, ...updated } } : s;
  }),

  clearUnread: (chatId) => set(s => ({
    chats: s.chats.map(c => c.id === chatId ? { ...c, unread_count: 0 } : c),
  })),
}));
