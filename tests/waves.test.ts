import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { ENEMY_DEFS } from '../src/game/enemies';
import {
  BOSSES,
  eliteChanceAt,
  hpScaleAt,
  phaseAt,
  pickEnemyKind,
  RUN_DURATION,
  spawnRateAt,
  speedScaleAt,
  SURGES,
  WAVE_TABLE,
} from '../src/game/waves';

describe('wave schedule', () => {
  it('phases are contiguous and monotonic from 0 to the run end', () => {
    expect(WAVE_TABLE[0]?.from).toBe(0);
    for (let i = 0; i < WAVE_TABLE.length; i++) {
      const phase = WAVE_TABLE[i];
      expect(phase).toBeDefined();
      if (phase === undefined) continue;
      expect(phase.to).toBeGreaterThan(phase.from);
      if (i > 0) expect(phase.from).toBe(WAVE_TABLE[i - 1]?.to);
    }
    expect(WAVE_TABLE[WAVE_TABLE.length - 1]?.to).toBe(RUN_DURATION);
  });

  it('spawn budget (enemies per second) never decreases over the run', () => {
    let prev = 0;
    for (let t = 0; t <= RUN_DURATION; t += 5) {
      const rate = spawnRateAt(t);
      expect(rate).toBeGreaterThanOrEqual(prev);
      prev = rate;
    }
    // And it genuinely grows: the end is much denser than the start.
    expect(spawnRateAt(RUN_DURATION - 1)).toBeGreaterThan(spawnRateAt(0) * 5);
  });

  it('bosses are scheduled at exactly 5:00 and 9:30', () => {
    expect(BOSSES.length).toBe(2);
    expect(BOSSES[0]?.t).toBe(300);
    expect(BOSSES[0]?.kind).toBe('boss1');
    expect(BOSSES[1]?.t).toBe(570);
    expect(BOSSES[1]?.kind).toBe('boss2');
  });

  it('surges are sorted in time and inside the run', () => {
    for (let i = 0; i < SURGES.length; i++) {
      const surge = SURGES[i];
      if (surge === undefined) continue;
      expect(surge.t).toBeGreaterThan(0);
      expect(surge.t).toBeLessThan(RUN_DURATION);
      if (i > 0) expect(surge.t).toBeGreaterThan(SURGES[i - 1]?.t ?? Infinity);
    }
  });

  it('pickEnemyKind only returns kinds present in the active phase', () => {
    const rng = new Rng(31);
    for (let t = 0; t < RUN_DURATION; t += 37) {
      const allowed = new Set(phaseAt(t).weights.map(([kind]) => kind));
      for (let i = 0; i < 25; i++) {
        expect(allowed.has(pickEnemyKind(t, rng))).toBe(true);
      }
    }
  });

  it('every kind referenced by the table has an enemy definition', () => {
    for (const phase of WAVE_TABLE) {
      for (const [kind] of phase.weights) {
        expect(ENEMY_DEFS[kind]).toBeDefined();
      }
    }
    for (const boss of BOSSES) expect(ENEMY_DEFS[boss.kind]).toBeDefined();
  });

  it('difficulty scalars grow monotonically and stay finite', () => {
    let prevHp = 0;
    let prevSpeed = 0;
    for (let t = 0; t <= RUN_DURATION; t += 10) {
      const hp = hpScaleAt(t);
      const speed = speedScaleAt(t);
      expect(Number.isFinite(hp)).toBe(true);
      expect(hp).toBeGreaterThanOrEqual(prevHp);
      expect(speed).toBeGreaterThanOrEqual(prevSpeed);
      prevHp = hp;
      prevSpeed = speed;
    }
    expect(hpScaleAt(RUN_DURATION)).toBeGreaterThan(5);
    expect(speedScaleAt(RUN_DURATION)).toBeLessThanOrEqual(1.5);
  });

  it('elite chance is zero at the start and capped', () => {
    expect(eliteChanceAt(0)).toBe(0);
    expect(eliteChanceAt(30)).toBe(0);
    for (let t = 80; t <= RUN_DURATION; t += 20) {
      expect(eliteChanceAt(t)).toBeGreaterThan(0);
      expect(eliteChanceAt(t)).toBeLessThanOrEqual(0.02);
    }
  });
});
