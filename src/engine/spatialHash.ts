const EMPTY_BUCKET: readonly number[] = [];

/**
 * Uniform-grid spatial hash for broad-phase collision queries.
 *
 * Entities are stored as circles in flat typed arrays (struct-of-arrays);
 * buckets map a packed numeric cell key to slot indices. Bucket arrays are
 * reused across frames (length reset, never freed), and queries dedup
 * multi-cell entries with a generation stamp instead of a Set, so a full
 * clear/insert/query cycle performs zero allocations once warm.
 */
export class SpatialHash {
  private buckets = new Map<number, number[]>();
  private xs: Float32Array;
  private ys: Float32Array;
  private rs: Float32Array;
  private idArr: Int32Array;
  private stamps: Uint32Array;
  private count = 0;
  private queryStamp = 0;

  /** Narrow-phase distance checks performed since the last clear(). */
  pairChecks = 0;

  constructor(
    readonly cellSize: number,
    capacity = 1024,
  ) {
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.rs = new Float32Array(capacity);
    this.idArr = new Int32Array(capacity);
    this.stamps = new Uint32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Packs signed cell coords into one 32-bit key (collision-free within ±32k cells). */
  private static key(cx: number, cy: number): number {
    return (((cx & 0xffff) << 16) | (cy & 0xffff)) >>> 0;
  }

  clear(): void {
    for (const bucket of this.buckets.values()) bucket.length = 0;
    this.count = 0;
    this.pairChecks = 0;
  }

  insert(id: number, x: number, y: number, radius: number): void {
    if (this.count === this.xs.length) this.grow();
    const slot = this.count++;
    this.xs[slot] = x;
    this.ys[slot] = y;
    this.rs[slot] = radius;
    this.idArr[slot] = id;
    this.stamps[slot] = 0;

    const inv = 1 / this.cellSize;
    const minX = Math.floor((x - radius) * inv);
    const maxX = Math.floor((x + radius) * inv);
    const minY = Math.floor((y - radius) * inv);
    const maxY = Math.floor((y + radius) * inv);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const key = SpatialHash.key(cx, cy);
        let bucket = this.buckets.get(key);
        if (bucket === undefined) {
          bucket = [];
          this.buckets.set(key, bucket);
        }
        bucket.push(slot);
      }
    }
  }

  /**
   * Collects ids of stored circles overlapping the query circle into `out`
   * (cleared first, reused by the caller). Returns `out`.
   */
  queryCircle(x: number, y: number, radius: number, out: number[]): number[] {
    out.length = 0;
    const stamp = this.nextStamp();
    const inv = 1 / this.cellSize;
    const minX = Math.floor((x - radius) * inv);
    const maxX = Math.floor((x + radius) * inv);
    const minY = Math.floor((y - radius) * inv);
    const maxY = Math.floor((y + radius) * inv);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.buckets.get(SpatialHash.key(cx, cy)) ?? EMPTY_BUCKET;
        for (let i = 0; i < bucket.length; i++) {
          const slot = bucket[i] as number;
          if (this.stamps[slot] === stamp) continue;
          this.stamps[slot] = stamp;
          this.pairChecks++;
          const dx = (this.xs[slot] as number) - x;
          const dy = (this.ys[slot] as number) - y;
          const rr = (this.rs[slot] as number) + radius;
          if (dx * dx + dy * dy <= rr * rr) out.push(this.idArr[slot] as number);
        }
      }
    }
    return out;
  }

  /** Collects ids of stored circles overlapping the axis-aligned box into `out`. */
  queryAABB(minX: number, minY: number, maxX: number, maxY: number, out: number[]): number[] {
    out.length = 0;
    const stamp = this.nextStamp();
    const inv = 1 / this.cellSize;
    const cMinX = Math.floor(minX * inv);
    const cMaxX = Math.floor(maxX * inv);
    const cMinY = Math.floor(minY * inv);
    const cMaxY = Math.floor(maxY * inv);
    for (let cy = cMinY; cy <= cMaxY; cy++) {
      for (let cx = cMinX; cx <= cMaxX; cx++) {
        const bucket = this.buckets.get(SpatialHash.key(cx, cy)) ?? EMPTY_BUCKET;
        for (let i = 0; i < bucket.length; i++) {
          const slot = bucket[i] as number;
          if (this.stamps[slot] === stamp) continue;
          this.stamps[slot] = stamp;
          this.pairChecks++;
          const r = this.rs[slot] as number;
          const px = this.xs[slot] as number;
          const py = this.ys[slot] as number;
          if (px + r >= minX && px - r <= maxX && py + r >= minY && py - r <= maxY) {
            out.push(this.idArr[slot] as number);
          }
        }
      }
    }
    return out;
  }

  private nextStamp(): number {
    this.queryStamp++;
    if (this.queryStamp === 0xffffffff) {
      this.stamps.fill(0);
      this.queryStamp = 1;
    }
    return this.queryStamp;
  }

  private grow(): void {
    const next = this.xs.length * 2;
    const xs = new Float32Array(next);
    const ys = new Float32Array(next);
    const rs = new Float32Array(next);
    const ids = new Int32Array(next);
    const stamps = new Uint32Array(next);
    xs.set(this.xs);
    ys.set(this.ys);
    rs.set(this.rs);
    ids.set(this.idArr);
    stamps.set(this.stamps);
    this.xs = xs;
    this.ys = ys;
    this.rs = rs;
    this.idArr = ids;
    this.stamps = stamps;
  }
}
