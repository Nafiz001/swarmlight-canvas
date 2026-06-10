import type { PassiveKind } from './upgrades';

export interface PlayerState {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  radius: number;
  hp: number;
  maxHp: number;
  baseSpeed: number;
  level: number;
  xp: number;
  kills: number;
  damageDealt: number;
  /** Seconds of invulnerability remaining after a hit. */
  iframes: number;
  /** 1 → 0 fade driving the red hurt vignette. */
  hurtPulse: number;
  /** Knockback velocity, decays exponentially. */
  kbX: number;
  kbY: number;
  passives: Record<PassiveKind, number>;
}

export const PLAYER_BASE_HP = 100;
export const PLAYER_BASE_SPEED = 175;
export const PLAYER_RADIUS = 11;
export const IFRAME_DURATION = 0.8;

export function createPlayer(): PlayerState {
  return {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    radius: PLAYER_RADIUS,
    hp: PLAYER_BASE_HP,
    maxHp: PLAYER_BASE_HP,
    baseSpeed: PLAYER_BASE_SPEED,
    level: 1,
    xp: 0,
    kills: 0,
    damageDealt: 0,
    iframes: 0,
    hurtPulse: 0,
    kbX: 0,
    kbY: 0,
    passives: { damage: 0, cooldown: 0, speed: 0, magnet: 0, maxhp: 0 },
  };
}

/**
 * XP required to advance FROM `level` to `level + 1`.
 * Linear early game keeps the first picks flowing; the power term slows
 * the curve to roughly one level-up per 20-30 s by the late game.
 */
export function xpForLevel(level: number): number {
  return Math.round(4 + (level - 1) * 4 + Math.pow(level - 1, 1.62));
}

/** Adds XP and returns how many level-ups it triggered. */
export function grantXp(player: PlayerState, amount: number): number {
  player.xp += amount;
  let ups = 0;
  while (player.xp >= xpForLevel(player.level)) {
    player.xp -= xpForLevel(player.level);
    player.level++;
    ups++;
  }
  return ups;
}

export function moveSpeed(p: PlayerState): number {
  return p.baseSpeed * (1 + 0.08 * p.passives.speed);
}

export function damageMultiplier(p: PlayerState): number {
  return 1 + 0.12 * p.passives.damage;
}

/** Multiplied into weapon cooldowns; below 1 means faster firing. */
export function cooldownMultiplier(p: PlayerState): number {
  return 1 / (1 + 0.09 * p.passives.cooldown);
}

export function magnetRadius(p: PlayerState): number {
  return 100 + 34 * p.passives.magnet;
}
