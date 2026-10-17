import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hasSession, signOut } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { SignIn } from './pages/SignIn';
import './styles.css';

function App() {
  const [state, setState] = useState<'checking' | 'in' | 'out'>('checking');

  useEffect(() => {
    hasSession()
      .then((ok) => setState(ok ? 'in' : 'out'))
      .catch(() => setState('out'));
  }, []);

  const out = useCallback(() => {
    void signOut();
    setState('out');
  }, []);

  if (state === 'checking') return null;
  return state === 'in' ? <Dashboard onSignOut={out} /> : <SignIn onSignedIn={() => setState('in')} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
