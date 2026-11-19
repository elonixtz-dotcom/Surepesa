import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEMO, hasSession, loadSession, MerchantSession, signOut } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { Onboarding } from './pages/Onboarding';
import { SignIn } from './pages/SignIn';
import './styles.css';

type State = { kind: 'checking' } | { kind: 'out' } | { kind: 'onboarding'; session: MerchantSession } | { kind: 'ready' };

/** Shown on every non-production deployment so test money is never mistaken for real money. */
const ENV_LABEL = import.meta.env.VITE_ENV_LABEL as string | undefined;

function App() {
  const [state, setState] = useState<State>({ kind: 'checking' });

  const route = useCallback(async () => {
    try {
      if (!(await hasSession())) return setState({ kind: 'out' });
      const session = await loadSession();
      setState(session.profileComplete && session.businesses.length ? { kind: 'ready' } : { kind: 'onboarding', session });
    } catch {
      setState({ kind: 'out' });
    }
  }, []);

  useEffect(() => {
    void route();
  }, [route]);

  const out = useCallback(() => {
    void signOut();
    setState({ kind: 'out' });
  }, []);

  return (
    <>
      {ENV_LABEL && !DEMO && (
        <div className="env-banner" role="note">
          <b>{ENV_LABEL}</b> · Test environment. Payments here use simulated mobile money and move no real funds.
        </div>
      )}
      {state.kind === 'out' && <SignIn onSignedIn={() => void route()} />}
      {state.kind === 'onboarding' && <Onboarding session={state.session} onDone={() => void route()} onSignOut={out} />}
      {state.kind === 'ready' && <Dashboard onSignOut={out} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
