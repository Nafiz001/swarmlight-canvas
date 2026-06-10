import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';

const STEP = 1 / 60;
const IDLE = { moveX: 0, moveY: 0 };

/** Runs the full simulation headless — the proof that game/ never touches the DOM. */
function runFor(game: Game, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    game.update(STEP, IDLE);
    // Auto-pick the first card so queued level-ups never stall the run.
    if (game.phase === 'levelup') game.chooseUpgrade(0);
  }
}

describe('Game (headless integration)', () => {
  it('boots a run, spawns enemies, and keeps every position finite', () => {
    const game = new Game();
    game.startRun(424242, false);
    runFor(game, 20);
    expect(game.enemies.liveCount).toBeGreaterThan(0);
    expect(game.time).toBeCloseTo(20, 0);
    for (let i = 0; i < game.enemies.liveCount; i++) {
      const e = game.enemies.at(i);
      expect(Number.isFinite(e.x)).toBe(true);
      expect(Number.isFinite(e.y)).toBe(true);
    }
    expect(Number.isFinite(game.player.hp)).toBe(true);
  });

  it('the starting weapon kills enemies and drops collectable XP', () => {
    const game = new Game();
    game.startRun(7, false);
    runFor(game, 60);
    expect(game.player.kills).toBeGreaterThan(0);
    expect(game.player.damageDealt).toBeGreaterThan(0);
    // Killing + collecting must eventually level the player up.
    expect(game.player.level).toBeGreaterThan(1);
  });

  it('identical seeds produce identical worlds; different seeds diverge', () => {
    const a = new Game();
    const b = new Game();
    const c = new Game();
    a.startRun(1234, false);
    b.startRun(1234, false);
    c.startRun(9999, false);
    runFor(a, 15);
    runFor(b, 15);
    runFor(c, 15);
    expect(a.enemies.liveCount).toBe(b.enemies.liveCount);
    expect(a.player.kills).toBe(b.player.kills);
    expect(a.player.xp).toBe(b.player.xp);
    if (a.enemies.liveCount > 0) {
      expect(a.enemies.at(0).x).toBe(b.enemies.at(0).x);
    }
    const sameAsC =
      a.enemies.liveCount === c.enemies.liveCount && a.player.kills === c.player.kills;
    expect(sameAsC).toBe(false);
  });

  it('pausing freezes the world', () => {
    const game = new Game();
    game.startRun(55, false);
    runFor(game, 5);
    const t = game.time;
    const count = game.enemies.liveCount;
    game.togglePause();
    runFor(game, 5);
    expect(game.time).toBe(t);
    expect(game.enemies.liveCount).toBe(count);
    game.togglePause();
    runFor(game, 1);
    expect(game.time).toBeGreaterThan(t);
  });

  it('player death ends the run in gameover', () => {
    const game = new Game();
    game.startRun(3, false);
    game.player.hp = 1;
    game.player.iframes = 0;
    // March into the swarm until something connects.
    const input = { moveX: 1, moveY: 0 };
    for (let i = 0; i < 60 * 120 && game.phase === 'running'; i++) {
      game.update(STEP, input);
      game.chooseUpgrade(0); // no-op unless a level-up is pending
    }
    expect(game.phase).toBe('gameover');
  });
});
