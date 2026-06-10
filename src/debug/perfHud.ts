import type { Game } from '../game/game';

const HISTORY = 120;
const SPARK_W = 180;
const SPARK_H = 30;
const TEXT_INTERVAL = 0.25; // throttle DOM text writes to 4 Hz

/**
 * F3 overlay: fps, a frame-time sparkline over the last 120 frames, live
 * entity counts, spatial-hash pair checks and pool utilization. The
 * sparkline is its own tiny canvas so the text nodes only update at 4 Hz.
 */
export class PerfHud {
  private readonly root: HTMLElement;
  private readonly spark: HTMLCanvasElement;
  private readonly sparkCtx: CanvasRenderingContext2D;
  private readonly textEl: HTMLElement;
  private readonly samples = new Float32Array(HISTORY);
  private cursor = 0;
  private textTimer = 0;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'perf';
    this.spark = document.createElement('canvas');
    this.spark.width = SPARK_W;
    this.spark.height = SPARK_H;
    this.root.appendChild(this.spark);
    this.textEl = document.createElement('div');
    this.root.appendChild(this.textEl);
    parent.appendChild(this.root);
    const ctx = this.spark.getContext('2d');
    if (ctx === null) throw new Error('2d context unavailable');
    this.sparkCtx = ctx;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('visible', this.visible);
  }

  frame(frameMs: number, frameDt: number, game: Game): void {
    if (!this.visible) return;

    this.samples[this.cursor] = frameMs;
    this.cursor = (this.cursor + 1) % HISTORY;
    this.drawSparkline();

    this.textTimer -= frameDt;
    if (this.textTimer > 0) return;
    this.textTimer = TEXT_INTERVAL;

    let sum = 0;
    for (let i = 0; i < HISTORY; i++) sum += this.samples[i] as number;
    const avg = sum / HISTORY;
    const fps = avg > 0 ? Math.round(1000 / avg) : 0;

    const enemies = game.enemies;
    const projectiles = game.projectiles;
    const pickups = game.pickups;
    this.textEl.innerHTML =
      `<b>${fps} fps</b> ${avg.toFixed(1)} ms avg<br>` +
      `enemies <b>${enemies.liveCount}</b>/${enemies.capacity} ` +
      `proj <b>${projectiles.liveCount}</b>/${projectiles.capacity}<br>` +
      `particles <b>${game.particles.count}</b>/${game.particles.capacity} ` +
      `gems <b>${pickups.liveCount}</b>/${pickups.capacity}<br>` +
      `hash pair-checks <b>${game.hash.pairChecks}</b>/frame`;
  }

  private drawSparkline(): void {
    const ctx = this.sparkCtx;
    ctx.clearRect(0, 0, SPARK_W, SPARK_H);
    // 16.7 ms (60 fps budget) reference line.
    const budgetY = SPARK_H - (16.7 / 33.3) * SPARK_H;
    ctx.fillStyle = 'rgba(242,237,228,0.18)';
    ctx.fillRect(0, budgetY, SPARK_W, 1);

    const barW = SPARK_W / HISTORY;
    for (let i = 0; i < HISTORY; i++) {
      const ms = this.samples[(this.cursor + i) % HISTORY] as number;
      const h = Math.min(SPARK_H, (ms / 33.3) * SPARK_H);
      ctx.fillStyle = ms > 17.5 ? '#e4574f' : '#e8b76a';
      ctx.fillRect(i * barW, SPARK_H - h, Math.max(1, barW - 0.5), h);
    }
  }
}
