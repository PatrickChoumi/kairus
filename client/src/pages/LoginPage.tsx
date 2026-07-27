import { useState } from 'react';
import { useAuthStore } from '../store/auth';
import { api } from '../lib/api';
import { toast } from '../lib/toast';

export default function LoginPage() {
  const { setAuth, setToken } = useAuthStore();
  const [isRegister, setIsRegister] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        const res = await api.auth.register(phone, password, displayName);
        setAuth(res.token, res.refreshToken, res.user);
        toast.success('Compte créé !');
      } else {
        const res = await api.auth.login(phone, password);
        if ((res as any).refreshToken) setAuth(res.token, (res as any).refreshToken, res.user);
        else setToken(res.token);
      }
    } catch (err: any) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-dark-bg p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center mx-auto mb-3 text-white font-bold text-xl">K</div>
          <h1 className="text-2xl font-semibold text-text-primary dark:text-white">Kairus</h1>
          <p className="text-sm text-text-secondary mt-1">Messagerie minimaliste</p>
        </div>

        {error && <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl border border-red-200 dark:border-red-800">{error}</div>}

        <input className="input" type="text" placeholder="Téléphone" value={phone} onChange={e => setPhone(e.target.value)} required aria-label="Téléphone" autoFocus />
        <input className="input" type="password" placeholder="Mot de passe" value={password} onChange={e => setPassword(e.target.value)} required aria-label="Mot de passe" minLength={6} />

        {isRegister && <input className="input" type="text" placeholder="Nom d'affichage" value={displayName} onChange={e => setDisplayName(e.target.value)} required aria-label="Nom d'affichage" />}

        <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
          {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {isRegister ? 'Créer un compte' : 'Se connecter'}
        </button>

        <button type="button" onClick={() => { setIsRegister(!isRegister); setError(''); }} className="w-full text-sm text-accent hover:underline text-center">
          {isRegister ? 'Déjà un compte ? Connectez-vous' : 'Pas de compte ? Créez-en un'}
        </button>
      </form>
    </div>
  );
}
