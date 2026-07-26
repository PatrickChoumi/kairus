export function useNotifications() {
  async function requestPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
  }

  function notify(title: string, body: string, chatId?: string) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, icon: '/favicon.ico' });
    n.onclick = chatId ? () => { window.focus(); n.close(); } : () => n.close();
    setTimeout(() => n.close(), 5000);
  }

  return { requestPermission, notify };
}
