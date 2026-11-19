import { describe, expect, it } from 'vitest';
import { hashTransactionPin, verifyPinHash } from '../src/services/pin.service';

describe('transaction PIN hashing', () => {
  it('stores a salted scrypt hash and verifies the original PIN', async () => {
    const encoded = await hashTransactionPin('482915');
    expect(encoded).not.toContain('482915');
    expect(await verifyPinHash('482915', encoded)).toBe(true);
    expect(await verifyPinHash('482916', encoded)).toBe(false);
  });
  it('rejects malformed PINs and unknown formats', async () => {
    await expect(hashTransactionPin('1234')).rejects.toMatchObject({ code: 'INVALID_PIN_FORMAT' });
    expect(await verifyPinHash('123456', 'plain$123456')).toBe(false);
  });
});
