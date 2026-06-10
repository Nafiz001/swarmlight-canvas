export interface Poolable {
  /** Index into the pool's backing array; maintained by the pool. */
  poolIndex: number;
}

/**
 * Object pool with O(1) swap-remove release. Live items occupy
 * items[0..liveCount-1]; freed items are parked past the boundary and reused
 * by the next acquire, so steady-state operation allocates nothing.
 */
export class Pool<T extends Poolable> {
  readonly items: T[] = [];
  liveCount = 0;

  constructor(
    private readonly create: () => T,
    prealloc = 0,
    private readonly max = Infinity,
  ) {
    for (let i = 0; i < prealloc; i++) {
      const item = this.create();
      item.poolIndex = i;
      this.items.push(item);
    }
  }

  get capacity(): number {
    return this.items.length;
  }

  /** Live item at index i (caller guarantees i < liveCount). */
  at(i: number): T {
    return this.items[i] as T;
  }

  acquire(): T {
    if (this.liveCount === this.items.length) {
      const item = this.create();
      item.poolIndex = this.items.length;
      this.items.push(item);
    }
    const item = this.items[this.liveCount] as T;
    item.poolIndex = this.liveCount;
    this.liveCount++;
    return item;
  }

  /** Like acquire(), but respects the pool's max size instead of growing. */
  tryAcquire(): T | null {
    if (this.liveCount >= this.max) return null;
    return this.acquire();
  }

  /** Swap-remove: the released slot is filled by the last live item. */
  release(item: T): void {
    const i = item.poolIndex;
    // Guard against double-release: the slot must still hold this item.
    if (i < 0 || i >= this.liveCount || this.items[i] !== item) return;
    const last = this.liveCount - 1;
    const lastItem = this.items[last] as T;
    this.items[i] = lastItem;
    lastItem.poolIndex = i;
    this.items[last] = item;
    item.poolIndex = last;
    this.liveCount = last;
  }

  releaseAll(): void {
    this.liveCount = 0;
  }
}
