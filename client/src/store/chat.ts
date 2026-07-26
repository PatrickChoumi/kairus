import { create } from 'zustand';

export interface User { id: string; phone: string; username?: string; display_name: string; avatar?: string; }
export interface Message { id: string; chat_id: string; sender_id: string; content?: string; type: string; media_path?: string; media_type?: string; reply_to?: string; edited: number; created_at: string; sender_name: string; sender_username: string; sender_avatar?: string; }
export interface Chat { id: string; type: 'private' | 'group'; title?: string; avatar?: string; created_by: string; created_at: string; last_message?: string; last_message_time?: string; members: User[]; }

interface ChatState {
  chats: Chat[];
  messages: Record<string, Message[]>;
  activeChat: string | null;
  setChats: (chats: Chat[]) => void;
  setMessages: (chatId: string, messages: Message[]) => void;
  addMessage: (message: Message) => void;
  editMessage: (message: Message) => void;
  deleteMessage: (id: string, chatId: string) => void;
  setActiveChat: (chatId: string | null) => void;
  addChat: (chat: Chat) => void;
  getChat: (chatId: string) => Chat | undefined;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  messages: {},
  activeChat: null,
  setChats: (chats) => set({ chats }),
  setMessages: (chatId, messages) => set((s) => ({ messages: { ...s.messages, [chatId]: messages } })),
  addMessage: (message) => set((s) => ({
    messages: s.messages[message.chat_id]?.find(m => m.id === message.id) ? s.messages : { ...s.messages, [message.chat_id]: [...(s.messages[message.chat_id] || []), message] },
    chats: s.chats.map(c => c.id === message.chat_id ? { ...c, last_message: message.content, last_message_time: message.created_at } : c),
  })),
  editMessage: (message) => set((s) => ({
    messages: { ...s.messages, [message.chat_id]: (s.messages[message.chat_id] || []).map(m => m.id === message.id ? message : m) },
  })),
  deleteMessage: (id, chatId) => set((s) => ({
    messages: { ...s.messages, [chatId]: (s.messages[chatId] || []).filter(m => m.id !== id) },
  })),
  setActiveChat: (chatId) => set({ activeChat: chatId }),
  addChat: (chat) => set((s) => s.chats.find(c => c.id === chat.id) ? s : { chats: [chat, ...s.chats] }),
  getChat: (chatId) => get().chats.find(c => c.id === chatId),
}));
