import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../src/engine/spatialHash';

describe('SpatialHash', () => {
  it('queryCircle returns exactly the ids inside the circle', () => {
    const hash = new SpatialHash(48);
    hash.insert(1, 0, 0, 5);
    hash.insert(2, 30, 0, 5);
    hash.insert(3, 200, 200, 5);
    hash.insert(4, -40, 10, 5);
    const out: number[] = [];
    hash.queryCircle(0, 0, 50, out);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });

  it('respects combined radii (stored circle + query circle)', () => {
    const hash = new SpatialHash(48);
    hash.insert(7, 100, 0, 20); // edge reaches x=80
    const out: number[] = [];
    hash.queryCircle(0, 0, 81, out);
    expect(out).toEqual([7]);
    hash.queryCircle(0, 0, 79, out);
    expect(out).toEqual([]);
  });

  it('does not return duplicates for entities spanning multiple cells', () => {
    const hash = new SpatialHash(16);
    hash.insert(9, 0, 0, 40); // covers many 16px cells
    const out: number[] = [];
    hash.queryCircle(0, 0, 60, out);
    expect(out).toEqual([9]);
  });

  it('handles negative coordinates', () => {
    const hash = new SpatialHash(48);
    hash.insert(1, -500, -500, 6);
    hash.insert(2, -460, -500, 6);
    const out: number[] = [];
    hash.queryCircle(-500, -500, 45, out);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('queryAABB returns entities overlapping the box', () => {
    const hash = new SpatialHash(48);
    hash.insert(1, 10, 10, 5);
    hash.insert(2, 100, 10, 5);
    hash.insert(3, 10, 104, 5); // overlaps via radius (edge at y=99)
    hash.insert(4, 300, 300, 5);
    const out: number[] = [];
    hash.queryAABB(0, 0, 50, 100, out);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it('clear() empties the index and resets the pair counter', () => {
    const hash = new SpatialHash(48);
    hash.insert(1, 0, 0, 5);
    const out: number[] = [];
    hash.queryCircle(0, 0, 10, out);
    expect(hash.pairChecks).toBeGreaterThan(0);
    hash.clear();
    expect(hash.size).toBe(0);
    expect(hash.pairChecks).toBe(0);
    hash.queryCircle(0, 0, 10, out);
    expect(out).toEqual([]);
  });

  it('pair-check counter counts narrow-phase work, not hits', () => {
    const hash = new SpatialHash(100);
    // Same cell, but far apart inside it: candidates without overlap.
    hash.insert(1, 5, 5, 1);
    hash.insert(2, 90, 90, 1);
    const out: number[] = [];
    hash.queryCircle(5, 5, 2, out);
    expect(out).toEqual([1]);
    // Both shared the queried cell, so both were checked.
    expect(hash.pairChecks).toBe(2);
  });

  it('a query far from everything checks nothing', () => {
    const hash = new SpatialHash(48);
    for (let i = 0; i < 100; i++) hash.insert(i, i * 10, 0, 4);
    hash.clear();
    for (let i = 0; i < 100; i++) hash.insert(i, i * 10, 0, 4);
    const before = hash.pairChecks;
    const out: number[] = [];
    hash.queryCircle(10000, 10000, 20, out);
    expect(out).toEqual([]);
    expect(hash.pairChecks).toBe(before);
  });
});
