import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { MetalPricesService } from './metal-prices.service';

vi.mock('@capacitor/preferences', () => {
  const store = new Map<string, string>();
  return {
    Preferences: {
      get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => void store.set(key, value)),
    },
  };
});

const body = (metal: string) => ({ date: '2026-11-01', [metal]: { usd: metal === 'xau' ? 3900 : 49, egp: metal === 'xau' ? 190000 : 2400 } });

describe('gold and silver prices', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the backup source when the first is down, keeps the prices, and shows them offline later', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('jsdelivr')) return new Response('down', { status: 503 });
      return Response.json(body(url.includes('xau') ? 'xau' : 'xag'));
    });
    vi.stubGlobal('fetch', fetcher);
    const metals = TestBed.inject(MetalPricesService);
    await metals.load();
    expect(metals.quotes()).toMatchObject({ date: '2026-11-01', gold: { egp: 190000 }, silver: { egp: 2400 } });
    expect(metals.currencies()).toEqual(['egp', 'usd']);
    expect(metals.failed()).toBe(false);

    // Offline: a forced refresh fails, the saved prices stay.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await metals.load(true);
    expect(metals.failed()).toBe(true);
    expect(metals.quotes()?.gold['egp']).toBe(190000);
  });
});
