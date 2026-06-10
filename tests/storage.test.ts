import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBest, recordRun } from '../src/storage';

const DEFAULTS = { bestTime: 0, bestKills: 0, bestLevel: 0, victories: 0, runs: 0 };

function stubStorage(overrides: Partial<Storage>): Record<string, string> {
  const backing: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key in backing ? backing[key] : null),
    setItem: (key: string, value: string) => {
      backing[key] = value;
    },
    ...overrides,
  });
  return backing;
}

afterEach(() => vi.unstubAllGlobals());

describe('storage', () => {
  it('returns defaults when localStorage does not exist at all (node, workers)', () => {
    // No stub: accessing the bare `localStorage` global throws a ReferenceError.
    expect(loadBest()).toEqual(DEFAULTS);
  });

  it('returns defaults for corrupt JSON', () => {
    stubStorage({ getItem: () => '{not json!' });
    expect(loadBest()).toEqual(DEFAULTS);
  });

  it('returns defaults for valid JSON that is not an object', () => {
    for (const raw of ['42', 'null', '"swarm"', 'true']) {
      stubStorage({ getItem: () => raw });
      expect(loadBest()).toEqual(DEFAULTS);
    }
  });

  it('sanitizes partial payloads and wrong-typed fields per key', () => {
    stubStorage({
      getItem: () => '{"bestTime":120.5,"bestKills":"999","victories":2,"bestLevel":null}',
    });
    expect(loadBest()).toEqual({
      bestTime: 120.5,
      bestKills: 0, // string rejected
      bestLevel: 0, // null rejected
      victories: 2,
      runs: 0, // missing
    });
  });

  it('recordRun keeps per-field maxima, counts runs and victories, and persists', () => {
    const backing = stubStorage({});
    recordRun(100, 50, 8, false);
    recordRun(80, 70, 6, true);
    const best = recordRun(90, 60, 9, true);
    expect(best).toEqual({ bestTime: 100, bestKills: 70, bestLevel: 9, victories: 2, runs: 3 });
    expect(JSON.parse(backing['swarmlight.v1'] as string)).toEqual(best);
  });

  it('recordRun still returns updated stats when setItem throws (quota/private mode)', () => {
    stubStorage({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const best = recordRun(42, 7, 3, true);
    expect(best).toEqual({ bestTime: 42, bestKills: 7, bestLevel: 3, victories: 1, runs: 1 });
  });
});
