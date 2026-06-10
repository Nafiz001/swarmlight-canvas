import { describe, expect, it } from 'vitest';
import {
  createPlayer,
  cooldownMultiplier,
  damageMultiplier,
  grantXp,
  magnetRadius,
  moveSpeed,
  xpForLevel,
} from '../src/game/player';

describe('xp / level curve', () => {
  it('is strictly positive, finite, and free of NaN for 200 levels', () => {
    for (let level = 1; level <= 200; level++) {
      const xp = xpForLevel(level);
      expect(Number.isFinite(xp)).toBe(true);
      expect(Number.isNaN(xp)).toBe(false);
      expect(xp).toBeGreaterThan(0);
      expect(Number.isInteger(xp)).toBe(true);
    }
  });

  it('is monotonically non-decreasing', () => {
    for (let level = 1; level < 200; level++) {
      expect(xpForLevel(level + 1)).toBeGreaterThanOrEqual(xpForLevel(level));
    }
  });

  it('levels up at exactly the threshold, not one XP early', () => {
    const p = createPlayer();
    const need = xpForLevel(1);
    expect(grantXp(p, need - 1)).toBe(0);
    expect(p.level).toBe(1);
    expect(grantXp(p, 1)).toBe(1);
    expect(p.level).toBe(2);
    expect(p.xp).toBe(0);
  });

  it('carries surplus XP across the threshold', () => {
    const p = createPlayer();
    const need = xpForLevel(1);
    grantXp(p, need + 3);
    expect(p.level).toBe(2);
    expect(p.xp).toBe(3);
  });

  it('one large grant can trigger multiple level-ups', () => {
    const p = createPlayer();
    const total = xpForLevel(1) + xpForLevel(2) + xpForLevel(3);
    expect(grantXp(p, total)).toBe(3);
    expect(p.level).toBe(4);
    expect(p.xp).toBe(0);
  });

  it('derived stats scale with passive levels', () => {
    const p = createPlayer();
    const baseSpeed = moveSpeed(p);
    const baseMagnet = magnetRadius(p);
    expect(damageMultiplier(p)).toBe(1);
    expect(cooldownMultiplier(p)).toBe(1);
    p.passives.speed = 5;
    p.passives.magnet = 5;
    p.passives.damage = 5;
    p.passives.cooldown = 5;
    expect(moveSpeed(p)).toBeGreaterThan(baseSpeed);
    expect(magnetRadius(p)).toBeGreaterThan(baseMagnet);
    expect(damageMultiplier(p)).toBeCloseTo(1.6);
    expect(cooldownMultiplier(p)).toBeLessThan(1);
  });
});
