import { FormEvent, useState } from 'react';
import { Brand } from '../components/Brand';
import { MerchantSession, registerBusiness, saveProfile } from '../lib/api';

const REGIONS = [
  'Arusha', 'Dar es Salaam', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi', 'Kigoma', 'Kilimanjaro', 'Lindi', 'Manyara',
  'Mara', 'Mbeya', 'Morogoro', 'Mtwara', 'Mwanza', 'Njombe', 'Pwani', 'Rukwa', 'Ruvuma', 'Shinyanga', 'Simiyu', 'Singida',
  'Songwe', 'Tabora', 'Tanga', 'Kaskazini Pemba', 'Kusini Pemba', 'Kaskazini Unguja', 'Kusini Unguja', 'Mjini Magharibi',
];

const CATEGORIES = [
  'Retail shop', 'Supermarket', 'Restaurant or café', 'Pharmacy', 'Hardware', 'Fashion and beauty', 'Electronics',
  'Transport and logistics', 'Education', 'Health services', 'Hospitality and travel', 'Professional services', 'Agriculture', 'Other',
];

/** "0712 345 678", "712345678", "+255712345678" -> "+255712345678" */
function toE164(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('255')) return `+${digits}`;
  if (digits.startsWith('0')) return `+255${digits.slice(1)}`;
  return `+255${digits}`;
}
const validTz = (e164: string) => /^\+255[67]\d{8}$/.test(e164);

/**
 * Two steps between a new account and the dashboard: who you are, then your business.
 * Identity documents (KYB) come afterwards, from the dashboard checklist.
 */
export function Onboarding({ session, onDone, onSignOut }: { session: MerchantSession; onDone: () => void; onSignOut: () => void }) {
  const step = session.profileComplete ? 2 : 1;
  return (
    <div className="onboard">
      <header className="topbar shell">
        <Brand />
        <div className="spacer" />
        <span className="muted small">{session.email}</span>
        <button className="btn ghost sm" onClick={onSignOut}>Sign out</button>
      </header>
      <main className="onboard-main">
        <ol className="stepper" aria-label="Setup progress">
          <li className={step === 1 ? 'current' : 'done'}><span>1</span>Your details</li>
          <li className={step === 2 ? 'current' : ''}><span>2</span>Your business</li>
          <li><span>3</span>Verification</li>
        </ol>
        <div className="card onboard-card">{step === 1 ? <ProfileStep onDone={onDone} /> : <BusinessStep onDone={onDone} />}</div>
        <p className="security-note center">Your information is used to verify your business, as required for payment services in Tanzania.</p>
      </main>
    </div>
  );
}

function ProfileStep({ onDone }: { onDone: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const e164 = toE164(phone);
  const ok = firstName.trim() && lastName.trim() && validTz(e164);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await saveProfile({ firstName: firstName.trim(), lastName: lastName.trim(), phoneNumber: e164 });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1>Your details</h1>
      <p className="auth-sub">The person responsible for this account. Use your name as it appears on your national ID (NIDA).</p>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="first">First name</label>
          <input id="first" className="text-input" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="last">Last name</label>
          <input id="last" className="text-input" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="phone">Mobile number</label>
        <div className="input-prefix">
          <span>+255</span>
          <input id="phone" className="text-input" inputMode="tel" autoComplete="tel-national" placeholder="712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <span className={`hint ${phone && !validTz(e164) ? 'bad' : ''}`}>A Tanzanian mobile number starting with 6 or 7.</span>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn primary" disabled={busy || !ok}>{busy ? 'Saving…' : 'Continue'}</button>
      </div>
    </form>
  );
}

function BusinessStep({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ legalName: '', tradingName: '', category: '', region: '', phone: '', registrationNo: '', tin: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  const phone = f.phone ? toE164(f.phone) : undefined;
  const tinOk = !f.tin || /^\d{3}-?\d{3}-?\d{3}$/.test(f.tin.trim());
  const ok = f.legalName.trim().length >= 2 && f.tradingName.trim().length >= 2 && f.category && f.region && (!phone || validTz(phone)) && tinOk && (f.registrationNo.trim() || f.tin.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const b = await registerBusiness({
        legalName: f.legalName.trim(),
        tradingName: f.tradingName.trim(),
        category: f.category,
        region: f.region,
        phoneNumber: phone,
        registrationNo: f.registrationNo.trim() || undefined,
        tin: f.tin.trim() || undefined,
      });
      setCreated(b.merchantCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register the business');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="notice-block" role="status">
        <h1>Your business is registered</h1>
        <p>Your till number is</p>
        <div className="till-number num">{created}</div>
        <p className="muted">Customers can pay you with it straight away. To withdraw funds, complete business verification from your dashboard.</p>
        <button className="btn primary" onClick={onDone}>Go to dashboard</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1>Your business</h1>
      <p className="auth-sub">These details appear on receipts and are checked during verification.</p>
      <div className="field">
        <label htmlFor="legal">Registered legal name</label>
        <input id="legal" className="text-input" autoComplete="organization" value={f.legalName} onChange={set('legalName')} placeholder="e.g. Mama Ntilie Foods Ltd" />
      </div>
      <div className="field">
        <label htmlFor="trading">Trading name</label>
        <input id="trading" className="text-input" value={f.tradingName} onChange={set('tradingName')} placeholder="The name customers see" />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="cat">Category</label>
          <select id="cat" className="text-input" value={f.category} onChange={set('category')}>
            <option value="" disabled>Select…</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="region">Region</label>
          <select id="region" className="text-input" value={f.region} onChange={set('region')}>
            <option value="" disabled>Select…</option>
            {REGIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="brela">BRELA registration number</label>
          <input id="brela" className="text-input" value={f.registrationNo} onChange={set('registrationNo')} />
        </div>
        <div className="field">
          <label htmlFor="tin">TIN</label>
          <input id="tin" className="text-input" inputMode="numeric" placeholder="123-456-789" value={f.tin} onChange={set('tin')} />
          {!tinOk && <span className="hint bad">A TIN has 9 digits.</span>}
        </div>
      </div>
      <span className="hint">Provide at least one: your BRELA number or your TRA Taxpayer Identification Number.</span>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="bphone">Business phone (optional)</label>
        <div className="input-prefix">
          <span>+255</span>
          <input id="bphone" className="text-input" inputMode="tel" value={f.phone} onChange={set('phone')} />
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn primary" disabled={busy || !ok}>{busy ? 'Registering…' : 'Register business'}</button>
      </div>
    </form>
  );
}
