import { User } from '../store/auth';

interface Props { user: User | null; onClose: () => void; }

export default function SettingsPanel({ user, onClose }: Props) {
  const isDark = document.documentElement.classList.contains('dark');
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-dark-secondary rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-tertiary dark:border-dark-tertiary">
          <h2 className="font-semibold">Settings</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-semibold text-lg">{user?.display_name?.[0]?.toUpperCase() || '?'}</div>
            <div>
              <p className="font-semibold">{user?.display_name}</p>
              <p className="text-sm text-text-secondary">{user?.phone}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Dark mode</span>
            <button onClick={() => { const next = !isDark; document.documentElement.classList.toggle('dark', next); localStorage.setItem('kairus_dark', String(next)); }} className={`w-11 h-6 rounded-full transition-colors relative ${isDark ? 'bg-accent' : 'bg-tertiary dark:bg-dark-tertiary'}`}>
              <div className={`w-5 h-5 rounded-full bg-white shadow-sm absolute top-0.5 transition-transform ${isDark ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <p className="text-xs text-text-tertiary text-center pt-4 border-t border-tertiary dark:border-dark-tertiary">Kairus v0.1.0</p>
        </div>
      </div>
    </div>
  );
}
