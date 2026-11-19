import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Provider resolution must fail closed (blueprint §4.3): an unconfigured provider is
 * rejected with PROVIDER_UNAVAILABLE, never silently rerouted to the simulator. The
 * SIMULATE_UNCONFIGURED_PROVIDERS escape hatch exists for development/test only and is
 * forced off in production no matter how it is set.
 */

const baseEnv: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  NEON_AUTH_BASE_URL: 'https://auth.example.com/neondb/auth',
  NEON_AUTH_JWKS_URL: 'https://auth.example.com/neondb/auth/.well-known/jwks.json',
  AWS_ENDPOINT_URL_S3: 'https://storage.example.com',
  AWS_ACCESS_KEY_ID: 'key',
  AWS_SECRET_ACCESS_KEY: 'secret',
  AWS_REGION: 'us-east-2',
  ADMIN_JWT_SECRET: 'a'.repeat(32),
  SIMULATED_WEBHOOK_SECRET: 's'.repeat(32),
};

const managedKeys = [
  ...Object.keys(baseEnv),
  'NODE_ENV',
  'SIMULATED_RAILS',
  'SIMULATE_UNCONFIGURED_PROVIDERS',
];
const saved = new Map<string, string | undefined>();

async function loadProviders(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of managedKeys) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
  }
  for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('../src/providers/index.js');
}

afterEach(() => {
  for (const key of managedKeys) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('provider resolution', () => {
  it('resolves the explicitly configured simulator', async () => {
    const { getProvider } = await loadProviders({ NODE_ENV: 'test' });
    expect(getProvider('SIMULATED').name).toBe('SIMULATED');
  });

  it('routes unconfigured providers to the simulator in development/test by default', async () => {
    const { getProvider } = await loadProviders({ NODE_ENV: 'test' });
    expect(getProvider('MPESA_TZ').name).toBe('SIMULATED');
  });

  it('rejects unconfigured providers when the fallback is switched off', async () => {
    const { getProvider } = await loadProviders({
      NODE_ENV: 'test',
      SIMULATE_UNCONFIGURED_PROVIDERS: 'false',
    });
    expect(() => getProvider('MPESA_TZ')).toThrowError(/PROVIDER_UNAVAILABLE|not configured/);
  });

  it('fails closed in production even when the fallback is explicitly requested', async () => {
    const { getProvider } = await loadProviders({
      NODE_ENV: 'production',
      SIMULATE_UNCONFIGURED_PROVIDERS: 'true',
    });
    expect(() => getProvider('MPESA_TZ')).toThrowError(/PROVIDER_UNAVAILABLE|not configured/);
  });

  it('refuses the simulator entirely when SIMULATED_RAILS=off', async () => {
    const { getProvider } = await loadProviders({ NODE_ENV: 'test', SIMULATED_RAILS: 'off' });
    expect(() => getProvider('SIMULATED')).toThrowError(/disabled/);
    expect(() => getProvider('MPESA_TZ')).toThrowError(/not configured|disabled/);
  });

  it('findProvider stays an exact lookup with no fallback', async () => {
    const { findProvider } = await loadProviders({ NODE_ENV: 'test' });
    expect(findProvider('SIMULATED')).toBeDefined();
    expect(findProvider('MPESA_TZ')).toBeUndefined();
  });
});
