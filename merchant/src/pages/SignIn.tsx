import { FormEvent, useState } from 'react';
import { signIn, signUp } from '../lib/api';
import { Brand } from '../components/Brand';

type Mode = 'sign-in' | 'sign-up';

/** Sign in, or create a merchant account. Neon Auth holds the credentials; SurePesa never sees the password at rest. */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authorised, setAuthorised] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifySent, setVerifySent] = useState(false);

  const signingUp = mode === 'sign-up';
  const passwordOk = password.length >= 8;
  const canSubmit = email.includes('@') && password.length > 0 && (!signingUp || (name.trim().length >= 2 && passwordOk && authorised));

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (signingUp) {
        const result = await signUp(name.trim(), email.trim(), password);
        if (result === 'verify-email') {
          setVerifySent(true);
          return;
        }
      } else {
        await signIn(email.trim(), password);
      }
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-split">
      <aside className="auth-panel" aria-hidden="true">
        <Brand inverse />
        <div className="auth-panel-copy">
          <h2>Payments infrastructure for Tanzanian businesses</h2>
          <ul className="auth-points">
            <li>
              <b>Every payment, recorded once</b>
              <span>Double-entry ledger with a full audit trail for each transaction.</span>
            </li>
            <li>
              <b>Payment requests by QR</b>
              <span>Single-use TANQR codes for a fixed amount, valid for 15 minutes.</span>
            </li>
            <li>
              <b>Controlled refunds</b>
              <span>Full or partial refunds, never more than the original payment.</span>
            </li>
          </ul>
        </div>
        <p className="auth-panel-foot">SurePesa is a product of SURECOM LIMITED, Dar es Salaam, Tanzania.</p>
      </aside>

      <section className="auth-form-wrap">
        <div className="auth-form">
          <div className="auth-mobile-brand"><Brand /></div>

          {verifySent ? (
            <div className="notice-block" role="status">
              <h1>Confirm your email</h1>
              <p>
                We sent a confirmation link to <b>{email}</b>. Open it to activate your account, then sign in here.
              </p>
              <button className="btn" onClick={() => { setVerifySent(false); switchTo('sign-in'); }}>Back to sign in</button>
            </div>
          ) : (
            <>
              <h1>{signingUp ? 'Create your business account' : 'Sign in to SurePesa for Business'}</h1>
              <p className="auth-sub">
                {signingUp ? 'It takes a few minutes. You will need your BRELA number or TIN.' : 'Use the email and password you registered with.'}
              </p>

              <div className="segmented" role="tablist" aria-label="Account">
                <button role="tab" aria-selected={!signingUp} className={!signingUp ? 'on' : ''} onClick={() => switchTo('sign-in')} type="button">
                  Sign in
                </button>
                <button role="tab" aria-selected={signingUp} className={signingUp ? 'on' : ''} onClick={() => switchTo('sign-up')} type="button">
                  Create account
                </button>
              </div>

              <form onSubmit={submit} noValidate>
                {signingUp && (
                  <div className="field">
                    <label htmlFor="name">Full name</label>
                    <input id="name" className="text-input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As on your national ID" />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="email">Work email</label>
                  <input id="email" className="text-input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <div className="password-wrap">
                    <input
                      id="password"
                      className="text-input"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={signingUp ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-describedby={signingUp ? 'pw-rule' : undefined}
                    />
                    <button type="button" className="reveal" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {signingUp && (
                    <span id="pw-rule" className={`hint ${password && !passwordOk ? 'bad' : ''}`}>
                      At least 8 characters. Do not reuse your mobile money PIN.
                    </span>
                  )}
                </div>

                {signingUp && (
                  <label className="check">
                    <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} />
                    <span>I am authorised to open an account for this business, and the details I provide are accurate.</span>
                  </label>
                )}

                {error && <p className="form-error" role="alert">{error}</p>}

                <button className="btn primary block" disabled={busy || !canSubmit}>
                  {busy ? (signingUp ? 'Creating account…' : 'Signing in…') : signingUp ? 'Create account' : 'Sign in'}
                </button>
              </form>

              <p className="security-note">
                SurePesa staff will never ask for your password or PIN by phone, SMS or email.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
