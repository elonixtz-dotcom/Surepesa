import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { CardEvent, CardEventKind, CardIssuer, InvalidCardEventError, IssueCardRequest, IssuedCard, RevealedCard } from './card-issuer';

/**
 * Stand-in card issuer for the prototype. Card numbers are derived from the issuer card id with
 * a keyed hash, so even the simulator keeps no card numbers anywhere: it recomputes them when
 * asked to reveal. Numbers use the 4000 00 test prefix and pass the Luhn check.
 *
 * Holder names containing "DECLINE" are refused at issue time (to demonstrate failures).
 */
export class SimulatedCardIssuer implements CardIssuer {
  readonly name = 'SIMULATED';
  static readonly SIGNATURE_HEADER = 'x-simulated-signature';
  static readonly TOLERANCE_SECONDS = 300;

  constructor(private readonly secret: string) {}

  async issueCard(req: IssueCardRequest): Promise<IssuedCard> {
    if (/DECLINE/i.test(req.holderName)) return { status: 'FAILED', failureReason: 'Issuer declined the application' };
    const issuerCardId = `SIMCARD-${req.reference}`;
    const now = new Date();
    const expiry = new Date(now.getFullYear(), now.getMonth() + req.validityMonths, 1);
    return {
      status: 'ACTIVE',
      issuerCardId,
      brand: 'VISA',
      last4: this.pan(issuerCardId).slice(-4),
      expiryMonth: expiry.getMonth() + 1,
      expiryYear: expiry.getFullYear(),
    };
  }

  async cardStatus(issuerCardId: string): Promise<IssuedCard> {
    return { status: 'ACTIVE', issuerCardId, brand: 'VISA', last4: this.pan(issuerCardId).slice(-4) };
  }

  async setStatus(): Promise<void> {}

  async setLimit(): Promise<void> {}

  async revealCard(issuerCardId: string): Promise<RevealedCard> {
    const digest = this.hmac(`cvv:${issuerCardId}`);
    const now = new Date();
    return {
      kind: 'DETAILS',
      pan: this.pan(issuerCardId),
      cvv: String(parseInt(digest.slice(0, 8), 16) % 1000).padStart(3, '0'),
      // The simulator does not remember issue dates; the stored expiry on the card is authoritative.
      expiryMonth: now.getMonth() + 1,
      expiryYear: now.getFullYear() + 2,
      holderName: 'SUREPESA CARDHOLDER',
    };
  }

  parseEvent(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): CardEvent {
    const header = headers[SimulatedCardIssuer.SIGNATURE_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) throw new InvalidCardEventError('Missing signature header');
    const parts = Object.fromEntries(value.split(',').map((p) => p.split('=', 2) as [string, string]));
    const timestamp = Number(parts.t);
    if (!Number.isInteger(timestamp) || !parts.v1) throw new InvalidCardEventError('Malformed signature header');
    if (Math.abs(Date.now() / 1000 - timestamp) > SimulatedCardIssuer.TOLERANCE_SECONDS) {
      throw new InvalidCardEventError('Signature timestamp outside tolerance');
    }
    const expected = Buffer.from(this.sign(timestamp, rawBody), 'hex');
    const given = Buffer.from(parts.v1, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new InvalidCardEventError('Signature mismatch');

    let b: Record<string, unknown>;
    try {
      b = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new InvalidCardEventError('Body is not JSON');
    }
    const kinds: CardEventKind[] = ['AUTHORIZATION', 'REVERSAL', 'REFUND'];
    if (
      typeof b.event_id !== 'string' ||
      !kinds.includes(b.kind as CardEventKind) ||
      typeof b.card_id !== 'string' ||
      typeof b.auth_id !== 'string' ||
      typeof b.amount !== 'string' ||
      !/^\d+$/.test(b.amount) ||
      typeof b.currency !== 'string'
    ) {
      throw new InvalidCardEventError('Missing or invalid fields');
    }
    return {
      eventId: b.event_id,
      kind: b.kind as CardEventKind,
      issuerCardId: b.card_id,
      authId: b.auth_id,
      amount: BigInt(b.amount),
      currency: b.currency,
      merchantName: typeof b.merchant_name === 'string' ? b.merchant_name : undefined,
      merchantCountry: typeof b.merchant_country === 'string' ? b.merchant_country : undefined,
    };
  }

  /** Builds a signed event, as the simulated issuer would send it. For tests and the dev "test purchase". */
  signedEvent(
    e: { kind: CardEventKind; issuerCardId: string; amount: bigint; currency?: string; authId?: string; eventId?: string; merchantName?: string; merchantCountry?: string },
    timestamp = Math.floor(Date.now() / 1000),
  ): { body: Buffer; headers: Record<string, string>; authId: string } {
    const authId = e.authId ?? `AUTH-${randomUUID()}`;
    const body = Buffer.from(
      JSON.stringify({
        event_id: e.eventId ?? `cev_${randomUUID()}`,
        kind: e.kind,
        card_id: e.issuerCardId,
        auth_id: authId,
        amount: e.amount.toString(),
        currency: e.currency ?? 'TZS',
        merchant_name: e.merchantName,
        merchant_country: e.merchantCountry,
      }),
    );
    return {
      body,
      authId,
      headers: { 'content-type': 'application/json', [SimulatedCardIssuer.SIGNATURE_HEADER]: `t=${timestamp},v1=${this.sign(timestamp, body)}` },
    };
  }

  private hmac(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('hex');
  }

  private sign(timestamp: number, rawBody: Buffer): string {
    return createHmac('sha256', this.secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  }

  /** 16-digit Luhn-valid test number: 400000 + 9 digits from the keyed hash + check digit. */
  private pan(issuerCardId: string): string {
    const digest = this.hmac(`pan:${issuerCardId}`);
    const body = `400000${(BigInt(`0x${digest.slice(0, 15)}`) % 1_000_000_000n).toString().padStart(9, '0')}`;
    return body + luhnCheckDigit(body);
  }
}

export function luhnCheckDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

export function luhnValid(pan: string): boolean {
  return luhnCheckDigit(pan.slice(0, -1)) === pan.slice(-1);
}
