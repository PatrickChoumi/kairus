import { useState, FormEvent } from 'react';
import { useAuthStore } from '../store/auth';

export default function LoginPage() {
  const { setAuth } = useAuthStore();
  const [reg, setReg] = useState(false);
  const [phone, setPhone] = useState('');
  const [pass, setPass] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    const body = reg ? { phone, password: pass, display_name: name } : { phone, password: pass };
    try {
      const r = await fetch(`/api/auth/${reg ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) return setErr(d.error);
      setAuth(d.token, d.user);
    } catch { setErr('Connection error'); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <div className="w-12 h-12 bg-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          </div>
          <h1 className="text-2xl font-semibold">Kairus</h1>
          <p className="text-text-secondary mt-1 text-sm">Minimal messenger</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input className="input" type="text" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} required />
          {reg && <input className="input" type="text" placeholder="Display name" value={name} onChange={e => setName(e.target.value)} required />}
          <input className="input" type="password" placeholder="Password" value={pass} onChange={e => setPass(e.target.value)} required />
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button className="btn-primary w-full" type="submit">{reg ? 'Create account' : 'Sign in'}</button>
        </form>
        <p className="text-center mt-6 text-sm text-text-secondary">
          {reg ? 'Already have an account?' : 'No account yet?'}
          <button className="text-accent hover:underline cursor-pointer ml-1" onClick={() => setReg(!reg)}>{reg ? 'Sign in' : 'Create one'}</button>
        </p>
      </div>
    </div>
  );
}
