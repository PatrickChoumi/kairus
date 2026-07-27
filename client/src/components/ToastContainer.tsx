import { useState, useEffect } from 'react';
import { toast } from '../lib/toast';

export default function ToastContainer() {
  const [toasts, setToasts] = useState<{ id: number; message: string; type: string }[]>([]);
  useEffect(() => toast.subscribe(setToasts), []);

  return (
    <div className="fixed bottom-6 right-6 z-[999] flex flex-col gap-2 pointer-events-none" role="alert" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`pointer-events-auto px-4 py-3 rounded-xl shadow-xl text-sm font-medium animate-slide-up
          ${t.type === 'success' ? 'bg-green-500 text-white' : t.type === 'error' ? 'bg-red-500 text-white' : 'bg-surface dark:bg-dark-secondary text-text-primary dark:text-white border border-border dark:border-dark-tertiary'}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
