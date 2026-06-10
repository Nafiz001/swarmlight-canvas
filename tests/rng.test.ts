import { describe, expect, it } from 'vitest';
import { Rng, hashSeed } from '../src/engine/rng';

describe('Rng (mulberry32)', () => {
  it('produces an identical sequence for the same seed', () => {
    const a = new Rng(123456);
    const b = new Rng(123456);
    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('diverges for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let identical = 0;
    for (let i = 0; i < 20; i++) {
      if (a.next() === b.next()) identical++;
    }
    expect(identical).toBeLessThan(3);
  });

  it('next() stays in [0, 1)', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('range() respects bounds', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng.range(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it('int() is inclusive of both ends and hits them', () => {
    const rng = new Rng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(1, 4);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
  });

  it('pick() only returns members and throws on empty', () => {
    const rng = new Rng(5);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items));
    }
    expect(() => rng.pick([])).toThrow();
  });

  it('shuffle() is a permutation and is deterministic per seed', () => {
    const a = new Rng(11).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Rng(11).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('hashSeed() is stable and 32-bit', () => {
    expect(hashSeed('2026-06-10')).toBe(hashSeed('2026-06-10'));
    expect(hashSeed('2026-06-10')).not.toBe(hashSeed('2026-06-11'));
    const h = hashSeed('anything');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});
