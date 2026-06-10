/** Particle color buckets; the renderer maps these to pre-rendered glow sprites. */
export const HUE = {
  gold: 0,
  violet: 1,
  teal: 2,
  white: 3,
  red: 4,
} as const;

export type HueId = (typeof HUE)[keyof typeof HUE];

export const HUE_COUNT = 5;

/**
 * Struct-of-arrays particle system over preallocated Float32Arrays.
 * Dead particles are swap-removed; spawns past capacity are dropped.
 * No per-frame allocation, ever.
 */
export class ParticleSystem {
  readonly capacity: number;
  count = 0;

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly drag: Float32Array;
  readonly hue: Uint8Array;

  constructor(capacity = 4096) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.hue = new Uint8Array(capacity);
  }

  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    hue: HueId,
    drag = 2,
  ): void {
    if (this.count === this.capacity) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.drag[i] = drag;
    this.hue[i] = hue;
  }

  update(dt: number): void {
    const { x, y, vx, vy, life, drag } = this;
    let i = 0;
    while (i < this.count) {
      const remaining = (life[i] as number) - dt;
      if (remaining <= 0) {
        // Swap-remove with the last live particle.
        const last = --this.count;
        x[i] = x[last] as number;
        y[i] = y[last] as number;
        vx[i] = vx[last] as number;
        vy[i] = vy[last] as number;
        life[i] = life[last] as number;
        this.maxLife[i] = this.maxLife[last] as number;
        this.size[i] = this.size[last] as number;
        drag[i] = drag[last] as number;
        this.hue[i] = this.hue[last] as number;
        continue; // re-examine swapped-in particle at index i
      }
      life[i] = remaining;
      const damp = 1 - (drag[i] as number) * dt;
      vx[i] = (vx[i] as number) * damp;
      vy[i] = (vy[i] as number) * damp;
      x[i] = (x[i] as number) + (vx[i] as number) * dt;
      y[i] = (y[i] as number) + (vy[i] as number) * dt;
      i++;
    }
  }

  clear(): void {
    this.count = 0;
  }
}
