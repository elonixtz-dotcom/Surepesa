import { describe, expect, it } from 'vitest';
import { getProvider } from '../src/providers';

describe('provider registry', () => {
  it('uses the simulator only when explicitly requested', () => {
    expect(getProvider('SIMULATED').name).toBe('SIMULATED');
  });
  it('fails closed for unconfigured live rails', () => {
    expect(() => getProvider('MPESA_TZ')).toThrowError(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }));
    expect(() => getProvider('AIRTEL_TZ')).toThrowError(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }));
  });
});
