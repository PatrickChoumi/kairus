import { useState } from 'react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import type { User } from '../lib/types';

interface Props { user: User | null; onClose: () => void; }

export default function SettingsPanel({ user, onClose }: Props) {
  const isDark = document.documentElement.classList.contains('dark');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await api.users.update({ display_name: displayName, username });
      toast.success('Profil mis à jour');
    } catch { toast.error('Erreur lors de la mise à jour'); } finally { setSaving(false); }
  }

  function toggleDark() {
    const next = !isDark;
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('kairus_dark', String(next));
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[8vh]" onClick={onClose}>
      <div className="w-full max-w-md bg-surface dark:bg-dark-secondary rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-dark-tertiary">
          <h2 className="font-semibold dark:text-white">Paramètres</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5 space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-semibold text-lg">{user?.display_name?.[0]?.toUpperCase() || '?'}</div>
            <div>
              <p className="font-semibold dark:text-white">{user?.display_name}</p>
              <p className="text-sm text-text-secondary">{user?.phone}</p>
            </div>
          </div>

          <div>
            <label className="text-xs text-text-secondary font-medium block mb-1">Nom d'affichage</label>
            <input className="w-full px-3 py-2 rounded-xl bg-surface-tertiary dark:bg-dark-tertiary text-sm dark:text-white outline-none" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>

          <div>
            <label className="text-xs text-text-secondary font-medium block mb-1">Nom d'utilisateur</label>
            <input className="w-full px-3 py-2 rounded-xl bg-surface-tertiary dark:bg-dark-tertiary text-sm dark:text-white outline-none" value={username} onChange={e => setUsername(e.target.value)} placeholder="defini un username" />
          </div>

          <button onClick={handleSave} disabled={saving} className="btn-primary w-full text-sm flex items-center justify-center gap-2">
            {saving && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Enregistrer
          </button>

          <div className="flex items-center justify-between pt-2">
            <span className="text-sm font-medium dark:text-white">Mode sombre</span>
            <button onClick={toggleDark} className={`w-11 h-6 rounded-full transition-colors relative ${isDark ? 'bg-accent' : 'bg-surface-tertiary dark:bg-dark-tertiary'}`} aria-label="Mode sombre" role="switch" aria-checked={isDark}>
              <div className={`w-5 h-5 rounded-full bg-white shadow-sm absolute top-0.5 transition-transform ${isDark ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          <p className="text-xs text-text-tertiary text-center pt-4 border-t border-border dark:border-dark-tertiary">Kairus v0.2.0</p>
        </div>
      </div>
    </div>
  );
}
