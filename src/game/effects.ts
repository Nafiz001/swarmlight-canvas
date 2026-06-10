import { Pool, type Poolable } from '../engine/pool';

/** Expanding ring used by Nova Pulse, level-ups and Starfall. */
export interface Shockwave extends Poolable {
  x: number;
  y: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  /** 0 = gold, 1 = violet (matches renderer hues). */
  tint: number;
}

/** Polyline for one Arc Lash strike; points are (x, y) pairs. */
export interface ArcBolt extends Poolable {
  points: Float32Array;
  /** Number of (x, y) pairs in use. */
  count: number;
  life: number;
  maxLife: number;
}

export const ARC_MAX_POINTS = 8;
const WAVE_LIFE = 0.35;
const ARC_LIFE = 0.18;

export class Effects {
  readonly waves: Pool<Shockwave>;
  readonly arcs: Pool<ArcBolt>;

  constructor() {
    this.waves = new Pool<Shockwave>(
      () => ({ poolIndex: -1, x: 0, y: 0, maxRadius: 0, life: 0, maxLife: WAVE_LIFE, tint: 0 }),
      16,
      48,
    );
    this.arcs = new Pool<ArcBolt>(
      () => ({
        poolIndex: -1,
        points: new Float32Array(ARC_MAX_POINTS * 2),
        count: 0,
        life: 0,
        maxLife: ARC_LIFE,
      }),
      8,
      24,
    );
  }

  spawnWave(x: number, y: number, maxRadius: number, tint = 0, life = WAVE_LIFE): void {
    const w = this.waves.tryAcquire();
    if (w === null) return;
    w.x = x;
    w.y = y;
    w.maxRadius = maxRadius;
    w.life = life;
    w.maxLife = life;
    w.tint = tint;
  }

  /** Returns a fresh arc to fill with points, or null if the pool is saturated. */
  beginArc(): ArcBolt | null {
    const arc = this.arcs.tryAcquire();
    if (arc === null) return null;
    arc.count = 0;
    arc.life = ARC_LIFE;
    return arc;
  }

  update(dt: number): void {
    for (let i = this.waves.liveCount - 1; i >= 0; i--) {
      const w = this.waves.at(i);
      w.life -= dt;
      if (w.life <= 0) this.waves.release(w);
    }
    for (let i = this.arcs.liveCount - 1; i >= 0; i--) {
      const a = this.arcs.at(i);
      a.life -= dt;
      if (a.life <= 0) this.arcs.release(a);
    }
  }

  clear(): void {
    this.waves.releaseAll();
    this.arcs.releaseAll();
  }
}
