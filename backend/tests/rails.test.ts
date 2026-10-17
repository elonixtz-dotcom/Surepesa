import { describe, expect, it } from 'vitest';
import { InvalidCallbackError } from '../src/providers/payment-provider';
import { SimulatedProvider } from '../src/providers/simulated.provider';
import { assertStrongPin } from '../src/services/pin.service';
import { applyFeeRule } from '../src/services/fee.service';
import { luhnValid, SimulatedCardIssuer } from '../src/providers/simulated-card-issuer';

const secret = 'test-secret-that-is-at-least-32-characters';
const rail = new SimulatedProvider(secret);

describe('simulated rail callbacks', () => {
  it('accepts a correctly signed callback', () => {
    const { body, headers } = rail.signedCallback({ reference: 'SPX-ABC', status: 'SUCCESS', eventId: 'evt_1' });
    expect(rail.parseCallback(body, headers)).toMatchObject({
      eventId: 'evt_1',
      reference: 'SPX-ABC',
      providerReference: 'SIM-SPX-ABC',
      status: 'SUCCESS',
    });
  });

  it('rejects a body changed after signing', () => {
    const { body, headers } = rail.signedCallback({ reference: 'SPX-ABC', status: 'FAILED' });
    const tampered = Buffer.from(body.toString().replace('FAILED', 'SUCCESS'));
    expect(() => rail.parseCallback(tampered, headers)).toThrow(InvalidCallbackError);
  });

  it('rejects a callback signed with another secret', () => {
    const { body, headers } = new SimulatedProvider('another-secret-that-is-also-32-chars-long').signedCallback({ reference: 'X', status: 'SUCCESS' });
    expect(() => rail.parseCallback(body, headers)).toThrow('Signature mismatch');
  });

  it('rejects replays outside the 5-minute tolerance', () => {
    const old = Math.floor(Date.now() / 1000) - 301;
    const { body, headers } = rail.signedCallback({ reference: 'X', status: 'SUCCESS' }, old);
    expect(() => rail.parseCallback(body, headers)).toThrow('outside tolerance');
  });

  it('rejects a missing or malformed signature', () => {
    const { body } = rail.signedCallback({ reference: 'X', status: 'SUCCESS' });
    expect(() => rail.parseCallback(body, {})).toThrow('Missing signature');
    expect(() => rail.parseCallback(body, { [SimulatedProvider.SIGNATURE_HEADER]: 'nonsense' })).toThrow('Malformed');
  });
});

describe('simulated rail behaviour', () => {
  it('answers like a real asynchronous rail, by account suffix', async () => {
    expect((await rail.collect({ reference: 'R', accountNumber: '0712341234' })).status).toBe('SUCCESS');
    expect((await rail.collect({ reference: 'R', accountNumber: '0712340000' })).status).toBe('FAILED');
    expect((await rail.collect({ reference: 'R', accountNumber: '0712341111' })).status).toBe('PENDING');
    expect((await rail.payout({ reference: 'R', accountNumber: '0712342222' })).status).toBe('AMBIGUOUS');
    await expect(rail.payout({ reference: 'R', accountNumber: '0712343333' })).rejects.toThrow('timeout');
  });

  it('reports where each scenario ends up when queried later', async () => {
    const q = (accountNumber: string) => rail.queryStatus({ kind: 'COLLECTION', reference: 'R', accountNumber });
    expect((await q('0712341111')).status).toBe('SUCCESS');
    expect((await q('0712343333')).status).toBe('SUCCESS'); // timed out, but the money moved
    expect((await q('0712344444')).status).toBe('FAILED');
    expect((await q('0712345555')).status).toBe('PENDING');
  });

  it('looks up the registered name, and refuses unknown accounts', async () => {
    expect(await rail.lookupAccount('+255712345678')).toEqual({ accountName: 'SIMULATED CUSTOMER 678', valid: true });
    expect(await rail.lookupAccount('+255712349999')).toEqual({ accountName: null, valid: false });
  });
});

describe('transaction PIN', () => {
  it('accepts reasonable PINs', () => {
    for (const pin of ['4825', '903172', '1357', '20481']) expect(() => assertStrongPin(pin)).not.toThrow();
  });

  it('rejects easy-to-guess and malformed PINs', () => {
    for (const pin of ['0000', '1111', '1234', '9876', '123456', '654321']) {
      expect(() => assertStrongPin(pin)).toThrow('harder to guess');
    }
    for (const pin of ['123', '1234567', '12a4', '']) expect(() => assertStrongPin(pin)).toThrow('4 to 6 digits');
  });
});

describe('fee rules as data', () => {
  it('applies percentage, minimum and cap', () => {
    const rule = { bps: 50, min: 50_000n, max: 500_000n };
    expect(applyFeeRule(rule, 1_000_00n)).toBe(500_00n); // below minimum
    expect(applyFeeRule(rule, 400_000_00n)).toBe(2_000_00n); // 0.5%
    expect(applyFeeRule(rule, 10_000_000_00n)).toBe(5_000_00n); // capped
    expect(applyFeeRule({ bps: 100, min: 0n, max: null }, 10_000_000_00n)).toBe(100_000_00n); // uncapped
    expect(applyFeeRule(undefined, 1_000_00n)).toBe(0n);
  });
});

describe('simulated card issuer', () => {
  const issuer = new SimulatedCardIssuer(secret);

  it('derives Luhn-valid test card numbers that match the stored last four', async () => {
    const card = await issuer.issueCard({ reference: 'abc', holderName: 'JUMA HAMISI', phoneNumber: '+255712345678', currency: 'TZS', validityMonths: 24 });
    const details = await issuer.revealCard(card.issuerCardId!);
    if (details.kind !== 'DETAILS') throw new Error('expected details');
    expect(details.pan).toMatch(/^400000\d{10}$/);
    expect(luhnValid(details.pan)).toBe(true);
    expect(details.pan.slice(-4)).toBe(card.last4);
    expect((await issuer.revealCard(card.issuerCardId!)).kind === 'DETAILS' && (await issuer.revealCard(card.issuerCardId!) as { pan: string }).pan).toBe(details.pan);
  });

  it('verifies event signatures and rejects tampering', () => {
    const { body, headers } = issuer.signedEvent({ kind: 'AUTHORIZATION', issuerCardId: 'SIMCARD-1', amount: 1_200_000n, merchantName: 'Netflix' });
    expect(issuer.parseEvent(body, headers)).toMatchObject({ kind: 'AUTHORIZATION', amount: 1_200_000n, merchantName: 'Netflix' });
    expect(() => issuer.parseEvent(Buffer.from(body.toString().replace('1200000', '1')), headers)).toThrow('Signature mismatch');
  });

  it('refuses applications the simulator is told to decline', async () => {
    expect((await issuer.issueCard({ reference: 'x', holderName: 'PLEASE DECLINE', phoneNumber: '', currency: 'TZS', validityMonths: 12 })).status).toBe('FAILED');
  });
});
