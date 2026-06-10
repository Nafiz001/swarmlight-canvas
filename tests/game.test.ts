import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { initEnemy, type EnemyKind } from '../src/game/enemies';

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

  it('wave composition is identical for the same seed regardless of input', () => {
    // The advertised determinism: the schedule stream must depend only on
    // time, never on how the run is played. Disarm both players so every
    // spawn stays alive and observable, then play them differently.
    const tally = (game: Game): { counts: Record<string, number>; elites: number } => {
      const counts: Record<string, number> = {};
      let elites = 0;
      for (let i = 0; i < game.enemies.liveCount; i++) {
        const e = game.enemies.at(i);
        counts[e.kind] = (counts[e.kind] ?? 0) + 1;
        if (e.elite) elites++;
      }
      return { counts, elites };
    };
    const play = (moveX: number): Game => {
      const game = new Game();
      game.startRun(20260610, false);
      game.weapons = []; // no kills: every spawned enemy stays countable
      game.player.maxHp = 1e9;
      game.player.hp = 1e9;
      const input = { moveX, moveY: 0 };
      for (let i = 0; i < 60 * 100; i++) game.update(STEP, input);
      return game;
    };
    const idle = play(0);
    const mover = play(1); // 17.5 km of travel: far-limit repositions galore
    expect(tally(mover)).toEqual(tally(idle));
  });

  it('upgrade draft hands depend only on the seed, not on how the run is played', () => {
    // The mover paces a small square (new direction every 2 s) so its input
    // trace is completely different from idle while it still racks up kills.
    const SQUARE = [
      { moveX: 1, moveY: 0 },
      { moveX: 0, moveY: 1 },
      { moveX: -1, moveY: 0 },
      { moveX: 0, moveY: -1 },
    ];
    const collectHands = (moving: boolean): string[][] => {
      const game = new Game();
      const hands: string[][] = [];
      game.events = { onLevelUp: (choices) => hands.push(choices.map((c) => c.title)) };
      game.startRun(31337, false);
      game.player.maxHp = 1e9;
      game.player.hp = 1e9;
      for (let i = 0; i < 60 * 90; i++) {
        const input = moving ? (SQUARE[Math.floor(i / 120) % 4] as { moveX: number; moveY: number }) : IDLE;
        game.update(STEP, input);
        if (game.phase === 'levelup') game.chooseUpgrade(0);
      }
      return hands;
    };
    const idle = collectHands(false);
    const mover = collectHands(true);
    // Level-up timing differs (kill rates differ), but the Nth hand must not.
    const shared = Math.min(idle.length, mover.length);
    expect(shared).toBeGreaterThanOrEqual(3);
    expect(mover.slice(0, shared)).toEqual(idle.slice(0, shared));
  });

  it('a boss spawn is never skipped, even with the enemy pool saturated', () => {
    const game = new Game();
    game.startRun(99, false);
    game.player.maxHp = 1e9;
    game.player.hp = 1e9;
    // Saturate the pool to its cap with regular enemies away from the player.
    for (let i = 0; ; i++) {
      const e = game.enemies.tryAcquire();
      if (e === null) break;
      const a = (i / 64) * Math.PI * 2;
      initEnemy(e, 'drifter', Math.cos(a) * (400 + i * 0.2), Math.sin(a) * (400 + i * 0.2), 1, 1, false);
    }
    const cap = game.enemies.liveCount;
    game.time = 299.99; // one step before the first boss
    game.update(STEP, IDLE);
    expect(game.activeBoss).not.toBeNull();
    expect(game.activeBoss?.kind).toBe('boss1');
    expect(game.bossName).toBe('Maw of Hollow');
    expect(game.enemies.liveCount).toBeLessThanOrEqual(cap);
  });

  it('spatial-hash pair checks stay bounded in a saturated max-build horde', () => {
    // Backs the README's performance numbers: a 2,000-enemy horde with every
    // weapon maxed. The sim is deterministic, so these bounds are exact
    // reproductions, not flaky wall-clock measurements.
    const game = new Game();
    game.startRun(4242, false);
    game.player.maxHp = 1e9;
    game.player.hp = 1e9;
    game.weapons = [
      { kind: 'ember', level: 5, timer: 0, angle: 0 },
      { kind: 'orbit', level: 5, timer: 0, angle: 0 },
      { kind: 'nova', level: 5, timer: 0, angle: 0 },
      { kind: 'wisp', level: 5, timer: 0, angle: 0 },
      { kind: 'arc', level: 5, timer: 0, angle: 0 },
    ];
    const kinds: EnemyKind[] = ['drifter', 'mite', 'mite', 'darter', 'bulwark', 'splitter'];
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; ; i++) {
      const e = game.enemies.tryAcquire();
      if (e === null) break;
      const a = i * GOLDEN;
      const r = 100 + 700 * Math.sqrt((i % 997) / 997);
      initEnemy(e, kinds[i % kinds.length] as EnemyKind, Math.cos(a) * r, Math.sin(a) * r, 9, 1.5, false);
    }
    let total = 0;
    let peak = 0;
    const frames = 300;
    for (let i = 0; i < frames; i++) {
      game.update(STEP, IDLE);
      if (game.phase === 'levelup') game.chooseUpgrade(0);
      const checks = game.hash.pairChecks;
      total += checks;
      if (checks > peak) peak = checks;
    }
    const average = total / frames;
    expect(average).toBeGreaterThan(0);
    expect(average).toBeLessThan(60_000); // measured ~42k
    expect(peak).toBeLessThan(250_000); // measured ~200k during wisp retargeting
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
