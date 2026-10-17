import { FormEvent, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createPaymentRequest } from '../lib/api';
import type { PaymentRequest } from '../lib/types';

const QUICK = ['5000', '10000', '25000', '50000'];

/**
 * Creates a single-use TANQR payment request for a fixed amount. Opening is occasional, so it
 * animates (220ms ease-out in, faster out); the dialog stays centred because it has no trigger
 * anchor.
 */
export function RequestPaymentDialog({ open, merchantCode, onClose }: { open: boolean; merchantCode: string; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PaymentRequest | null>(null);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setError(null);
    setResult(null);
    setCopied(false);
    const t = setTimeout(() => input.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d+$/.test(amount) || Number(amount) < 100) {
      setError('Enter an amount of at least TZS 100');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await createPaymentRequest(merchantCode, amount));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the request');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.payload).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const shown = Number(amount || 0).toLocaleString('en-US');
  const expires = result ? new Date(result.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="backdrop" data-state={open ? 'open' : 'closed'} onMouseDown={(e) => e.target === e.currentTarget && onClose()} aria-hidden={!open}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="req-title">
        {!result ? (
          <form onSubmit={submit} noValidate>
            <h2 id="req-title">Request a payment</h2>
            <p>The customer scans the code with any TANQR app and pays exactly this amount. It works once and expires in 15 minutes.</p>
            <div className="field">
              <label htmlFor="req-amount">Amount</label>
              <div className="input-wrap">
                <span>TZS</span>
                <input
                  id="req-amount"
                  ref={input}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0"
                  value={amount ? Number(amount).toLocaleString('en-US') : ''}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 9))}
                />
              </div>
            </div>
            <div className="quick" role="group" aria-label="Quick amounts">
              {QUICK.map((q) => (
                <button type="button" key={q} className="btn sm" onClick={() => setAmount(q)}>
                  {Number(q).toLocaleString('en-US')}
                </button>
              ))}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn primary" disabled={busy || !amount}>
                {busy ? 'Creating…' : amount ? `Request TZS ${shown}` : 'Create request'}
              </button>
            </div>
          </form>
        ) : (
          <div className="qr-result">
            <h2 id="req-title">Ready to scan</h2>
            <div className="qr-frame">
              <QRCodeSVG value={result.payload} size={184} level="M" marginSize={0} bgColor="#ffffff" fgColor="#1d140e" title={`TANQR payment request for TZS ${result.amount}`} />
            </div>
            <div className="qr-amount num">TZS {Number(result.amount).toLocaleString('en-US')}</div>
            <p className="muted" style={{ margin: 0 }}>
              Single use · expires at {expires} · till {result.merchantCode}
            </p>
            <div className="payload" aria-label="TANQR payload">{result.payload}</div>
            <div className="dialog-actions" style={{ width: '100%' }}>
              <button type="button" className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy code'}</button>
              <button type="button" className="btn primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
