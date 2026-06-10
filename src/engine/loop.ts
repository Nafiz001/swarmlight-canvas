const STEP = 1 / 60;
const MAX_ACCUMULATED = 0.25; // clamp so a backgrounded tab never spirals

/**
 * Fixed 60 Hz simulation loop with render interpolation.
 *
 * The accumulator is clamped to 250 ms: after a long tab-switch the sim takes
 * at most 15 catch-up steps instead of thousands. `timeScale` slows game time
 * (level-up slow-mo) without affecting render cadence.
 */
export class GameLoop {
  timeScale = 1;
  /** Raw duration of the last animation frame, in ms (for the perf HUD). */
  frameMs = 0;

  private accumulator = 0;
  private last = 0;
  private rafId = 0;
  private running = false;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    let frame = (now - this.last) / 1000;
    this.last = now;
    this.frameMs = frame * 1000;
    if (frame > MAX_ACCUMULATED) frame = MAX_ACCUMULATED;

    this.accumulator += frame * this.timeScale;
    if (this.accumulator > MAX_ACCUMULATED) this.accumulator = MAX_ACCUMULATED;
    while (this.accumulator >= STEP) {
      this.update(STEP);
      this.accumulator -= STEP;
    }

    this.render(this.accumulator / STEP, frame);
  };
}
