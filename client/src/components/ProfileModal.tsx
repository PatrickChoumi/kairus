import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

interface Props { userId: string; name: string; avatar?: string; onClose: () => void; }

export default function ProfileModal({ userId, name, avatar, onClose }: Props) {
  const { onlineUsers } = useAuthStore();
  const [chat, setChat] = useState<any>(null);
  const isOnline = onlineUsers.has(userId);

  useEffect(() => {
    api.chats.list().then(chats => {
      const c = chats.find((ch: any) => ch.id === userId);
      if (c) setChat(c);
    }).catch(() => {});
  }, [userId]);

  const memberCount = chat?.members?.length || 0;
  const isGroup = chat?.type === 'group';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="w-full max-w-sm bg-surface dark:bg-dark-secondary rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="pt-8 pb-5 px-6 flex flex-col items-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold text-2xl mb-3">{name?.[0]?.toUpperCase() || '?'}</div>
          <h2 className="text-lg font-semibold dark:text-white">{name}</h2>
          <span className={`text-sm mt-0.5 ${isOnline ? 'text-green-500' : 'text-text-tertiary'}`}>{isOnline ? 'En ligne' : 'Hors ligne'}</span>

          <div className="flex gap-6 mt-5 pt-4 border-t border-border dark:border-dark-tertiary w-full justify-center">
            {isGroup ? (
              <div className="text-center">
                <p className="text-lg font-semibold dark:text-white">{memberCount}</p>
                <p className="text-xs text-text-secondary">membres</p>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <p className="text-lg font-semibold dark:text-white">{chat ? '✓' : '—'}</p>
                  <p className="text-xs text-text-secondary">messages</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold dark:text-white">{isOnline ? '🟢' : '⚪'}</p>
                  <p className="text-xs text-text-secondary">statut</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
