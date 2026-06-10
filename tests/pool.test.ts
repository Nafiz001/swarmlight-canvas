import { describe, expect, it } from 'vitest';
import { Pool, type Poolable } from '../src/engine/pool';

interface Thing extends Poolable {
  id: number;
}

let nextId = 0;
const makeThing = (): Thing => ({ poolIndex: -1, id: nextId++ });

describe('Pool', () => {
  it('acquire places items contiguously with correct poolIndex', () => {
    const pool = new Pool<Thing>(makeThing);
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    expect(pool.liveCount).toBe(3);
    expect(a.poolIndex).toBe(0);
    expect(b.poolIndex).toBe(1);
    expect(c.poolIndex).toBe(2);
    expect(pool.at(1)).toBe(b);
  });

  it('release swap-removes: the last live item fills the hole', () => {
    const pool = new Pool<Thing>(makeThing);
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    pool.release(a);
    expect(pool.liveCount).toBe(2);
    // c was last; it should now sit at index 0.
    expect(pool.at(0)).toBe(c);
    expect(c.poolIndex).toBe(0);
    expect(pool.at(1)).toBe(b);
    // The live set is exactly {b, c}.
    const live = new Set([pool.at(0), pool.at(1)]);
    expect(live.has(b)).toBe(true);
    expect(live.has(c)).toBe(true);
    expect(live.has(a)).toBe(false);
  });

  it('reuses released objects instead of allocating', () => {
    const pool = new Pool<Thing>(makeThing);
    const a = pool.acquire();
    pool.release(a);
    const b = pool.acquire();
    expect(b).toBe(a);
    expect(pool.capacity).toBe(1);
  });

  it('double release is a no-op', () => {
    const pool = new Pool<Thing>(makeThing);
    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(a);
    expect(pool.liveCount).toBe(1);
    expect(pool.at(0)).toBe(b);
  });

  it('prealloc creates capacity without live items', () => {
    const pool = new Pool<Thing>(makeThing, 8);
    expect(pool.capacity).toBe(8);
    expect(pool.liveCount).toBe(0);
    pool.acquire();
    expect(pool.capacity).toBe(8);
  });

  it('tryAcquire honors the max bound; acquire-release cycles stay consistent', () => {
    const pool = new Pool<Thing>(makeThing, 0, 2);
    expect(pool.tryAcquire()).not.toBeNull();
    expect(pool.tryAcquire()).not.toBeNull();
    expect(pool.tryAcquire()).toBeNull();
    pool.release(pool.at(0));
    expect(pool.tryAcquire()).not.toBeNull();
    expect(pool.liveCount).toBe(2);
  });

  it('survives a randomized churn without corrupting the live set', () => {
    const pool = new Pool<Thing>(makeThing);
    const live = new Set<Thing>();
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let step = 0; step < 2000; step++) {
      if (rand() < 0.6 || live.size === 0) {
        live.add(pool.acquire());
      } else {
        const victim = [...live][Math.floor(rand() * live.size)] as Thing;
        live.delete(victim);
        pool.release(victim);
      }
    }
    expect(pool.liveCount).toBe(live.size);
    for (let i = 0; i < pool.liveCount; i++) {
      const item = pool.at(i);
      expect(item.poolIndex).toBe(i);
      expect(live.has(item)).toBe(true);
    }
  });
});
