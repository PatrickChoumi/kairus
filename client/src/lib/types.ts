export interface User {
  id: string; phone: string; username?: string; display_name: string; avatar?: string;
}

export interface Message {
  id: string; chat_id: string; sender_id: string; content?: string;
  type: string; media_path?: string; media_type?: string; reply_to?: string;
  edited: number; created_at: string; updated_at?: string;
  sender_name: string; sender_username: string; sender_avatar?: string;
  reactions?: { emoji: string; user_id: string }[];
  readBy?: string[];
  replyPreview?: { id: string; content: string; senderName: string } | null;
}

export interface Chat {
  id: string; type: 'private' | 'group'; title?: string; avatar?: string;
  created_by: string; created_at: string;
  last_message?: string; last_message_time?: string;
  unread_count?: number;
  members: User[];
}

export interface Contact {
  user_id: string; contact_id: string; display_name?: string;
  added_at: string; phone: string; username?: string; avatar?: string;
}
