import { Pool, type Poolable } from '../engine/pool';

export interface DamageNumber extends Poolable {
  x: number;
  y: number;
  /** Integer damage value; the renderer draws digits from a pre-baked atlas. */
  value: number;
  life: number;
  maxLife: number;
}

const MAX_LIVE = 96;
const LIFETIME = 0.7;
const RISE_SPEED = 46;

/**
 * Pooled floating damage numbers, hard-capped at 96 live: past the cap new
 * spawns are dropped (with hundreds of hits per second more text is noise,
 * not information).
 */
export class DamageNumbers {
  readonly pool: Pool<DamageNumber>;

  constructor() {
    this.pool = new Pool<DamageNumber>(
      () => ({ poolIndex: -1, x: 0, y: 0, value: 0, life: 0, maxLife: LIFETIME }),
      MAX_LIVE,
      MAX_LIVE,
    );
  }

  spawn(x: number, y: number, value: number): void {
    const n = this.pool.tryAcquire();
    if (n === null) return;
    n.x = x;
    n.y = y - 8;
    n.value = Math.max(1, Math.round(value));
    n.life = LIFETIME;
  }

  update(dt: number): void {
    for (let i = this.pool.liveCount - 1; i >= 0; i--) {
      const n = this.pool.at(i);
      n.life -= dt;
      if (n.life <= 0) {
        this.pool.release(n);
        continue;
      }
      n.y -= RISE_SPEED * dt;
    }
  }

  clear(): void {
    this.pool.releaseAll();
  }
}
