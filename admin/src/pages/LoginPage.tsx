import { FormEvent, useState } from 'react';
import { useAuth } from '../lib/auth';
import { ErrorBox } from '../components/ui';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="logo" style={{ padding: 0 }}>
          <div className="logo-mark" aria-hidden="true">₷</div>
          <div>
            SurePesa
            <small>Back Office · staff only</small>
          </div>
        </div>
        <div>
          <h1>Sign in</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Use your SURECOM staff account. All activity is logged.</p>
        </div>
        <label className="field">
          Work email
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          Password
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error != null && <ErrorBox error={error} />}
        <button className="btn primary" disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
