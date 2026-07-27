type ToastType = 'success' | 'error' | 'info';

interface Toast { id: number; message: string; type: ToastType; }

let listeners: ((toasts: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
let nextId = 1;

function notify() { listeners.forEach(fn => fn([...toasts])); }

export const toast = {
  show: (message: string, type: ToastType = 'info') => {
    const id = nextId++;
    toasts = [...toasts, { id, message, type }];
    notify();
    setTimeout(() => { toasts = toasts.filter(t => t.id !== id); notify(); }, 4000);
  },
  success: (msg: string) => toast.show(msg, 'success'),
  error: (msg: string) => toast.show(msg, 'error'),
  info: (msg: string) => toast.show(msg, 'info'),
  subscribe: (fn: (toasts: Toast[]) => void) => { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn); }; },
};
