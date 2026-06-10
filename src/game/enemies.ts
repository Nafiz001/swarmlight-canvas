import type { Poolable } from '../engine/pool';
import type { SpatialHash } from '../engine/spatialHash';
import type { PlayerState } from './player';

export type EnemyKind =
  | 'drifter'
  | 'mite'
  | 'darter'
  | 'bulwark'
  | 'splitter'
  | 'boss1'
  | 'boss2';

export interface EnemyDef {
  hp: number;
  speed: number;
  radius: number;
  /** Contact damage to the player. */
  damage: number;
  /** XP value dropped on death. */
  xp: number;
  /** Mass resists separation pushes and knockback. */
  mass: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  drifter: { hp: 14, speed: 56, radius: 11, damage: 8, xp: 1, mass: 1 },
  mite: { hp: 6, speed: 110, radius: 7, damage: 5, xp: 1, mass: 0.6 },
  darter: { hp: 18, speed: 78, radius: 9, damage: 10, xp: 5, mass: 0.9 },
  bulwark: { hp: 90, speed: 30, radius: 19, damage: 14, xp: 5, mass: 3.5 },
  splitter: { hp: 26, speed: 64, radius: 12, damage: 9, xp: 5, mass: 1.2 },
  boss1: { hp: 2600, speed: 46, radius: 40, damage: 24, xp: 25, mass: 30 },
  boss2: { hp: 7200, speed: 54, radius: 46, damage: 32, xp: 25, mass: 40 },
};

/** Darter behavior phases. */
export const DART = { chase: 0, windup: 1, dash: 2, recover: 3 } as const;

const DART_TRIGGER_DIST = 240;
const DART_WINDUP = 0.55;
const DART_DURATION = 0.4;
const DART_RECOVER = 0.9;
const DART_SPEED_MULT = 4.2;

export interface Enemy extends Poolable {
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  xp: number;
  mass: number;
  elite: boolean;
  /** 0 = normal enemy, 1 = first boss, 2 = final boss. */
  boss: 0 | 1 | 2;
  /** 1 → 0 white flash after taking damage. */
  hitFlash: number;
  kbX: number;
  kbY: number;
  /** Behavior phase (darters) — see DART. */
  phase: number;
  phaseTimer: number;
  /** Locked dash direction for darters. */
  dashX: number;
  dashY: number;
  /** Timer for boss minion bursts. */
  emitTimer: number;
  /** uid of the last projectile that hit (prevents per-frame re-hits while overlapping). */
  lastHitUid: number;
  /** Game-time of the last orbit-ward hit (wards re-hit on an interval). */
  lastOrbitHit: number;
}

export function createEnemy(): Enemy {
  return {
    poolIndex: -1,
    kind: 'drifter',
    x: 0,
    y: 0,
    hp: 1,
    maxHp: 1,
    radius: 1,
    speed: 0,
    damage: 0,
    xp: 0,
    mass: 1,
    elite: false,
    boss: 0,
    hitFlash: 0,
    kbX: 0,
    kbY: 0,
    phase: 0,
    phaseTimer: 0,
    dashX: 0,
    dashY: 0,
    emitTimer: 0,
    lastHitUid: -1,
    lastOrbitHit: -1,
  };
}

export function initEnemy(
  e: Enemy,
  kind: EnemyKind,
  x: number,
  y: number,
  hpScale: number,
  speedScale: number,
  elite: boolean,
): void {
  const def = ENEMY_DEFS[kind];
  e.kind = kind;
  e.x = x;
  e.y = y;
  e.elite = elite;
  e.boss = kind === 'boss1' ? 1 : kind === 'boss2' ? 2 : 0;
  e.maxHp = def.hp * hpScale * (elite ? 10 : 1);
  e.hp = e.maxHp;
  e.radius = def.radius * (elite ? 2 : 1);
  e.speed = def.speed * speedScale * (elite ? 0.85 : 1);
  e.damage = def.damage * (elite ? 1.5 : 1);
  e.xp = def.xp * (elite ? 4 : 1);
  e.mass = def.mass * (elite ? 4 : 1);
  e.hitFlash = 0;
  e.kbX = 0;
  e.kbY = 0;
  e.phase = DART.chase;
  e.phaseTimer = 0;
  e.dashX = 0;
  e.dashY = 0;
  e.emitTimer = 0;
  e.lastHitUid = -1;
  e.lastOrbitHit = -1;
}

const MAX_SEPARATION_NEIGHBORS = 6;
const SEPARATION_STRENGTH = 38;

/**
 * Steering + behavior for one enemy. Separation pushes are applied by the
 * caller on alternating frames (with doubled strength) to halve the number
 * of spatial-hash queries — see Game.update.
 */
export function updateEnemySteering(e: Enemy, player: PlayerState, dt: number): void {
  let dirX = player.x - e.x;
  let dirY = player.y - e.y;
  const dist = Math.hypot(dirX, dirY) || 1;
  dirX /= dist;
  dirY /= dist;

  let vx = 0;
  let vy = 0;

  if (e.kind === 'darter' && e.boss === 0) {
    switch (e.phase) {
      case DART.chase:
        vx = dirX * e.speed;
        vy = dirY * e.speed;
        if (dist < DART_TRIGGER_DIST) {
          e.phase = DART.windup;
          e.phaseTimer = DART_WINDUP;
        }
        break;
      case DART.windup:
        // Telegraph: hold still, lock aim at the end of the windup.
        e.phaseTimer -= dt;
        if (e.phaseTimer <= 0) {
          e.phase = DART.dash;
          e.phaseTimer = DART_DURATION;
          e.dashX = dirX;
          e.dashY = dirY;
        }
        break;
      case DART.dash:
        vx = e.dashX * e.speed * DART_SPEED_MULT;
        vy = e.dashY * e.speed * DART_SPEED_MULT;
        e.phaseTimer -= dt;
        if (e.phaseTimer <= 0) {
          e.phase = DART.recover;
          e.phaseTimer = DART_RECOVER;
        }
        break;
      default: // recover
        vx = dirX * e.speed * 0.35;
        vy = dirY * e.speed * 0.35;
        e.phaseTimer -= dt;
        if (e.phaseTimer <= 0) e.phase = DART.chase;
        break;
    }
  } else {
    vx = dirX * e.speed;
    vy = dirY * e.speed;
  }

  // Knockback decays exponentially and is resisted by mass.
  const decay = Math.max(0, 1 - 6 * dt);
  e.kbX *= decay;
  e.kbY *= decay;

  e.x += (vx + e.kbX / e.mass) * dt;
  e.y += (vy + e.kbY / e.mass) * dt;

  if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - 5 * dt);
}

/**
 * Soft separation: pushes this enemy away from overlapping neighbors found
 * in the spatial hash. Neighbor checks are capped for performance.
 */
export function applySeparation(
  e: Enemy,
  hash: SpatialHash,
  enemyAt: (id: number) => Enemy,
  buf: number[],
  strengthScale: number,
  dt: number,
): void {
  hash.queryCircle(e.x, e.y, e.radius, buf);
  let pushX = 0;
  let pushY = 0;
  let checked = 0;
  for (let i = 0; i < buf.length && checked < MAX_SEPARATION_NEIGHBORS; i++) {
    const other = enemyAt(buf[i] as number);
    if (other === e) continue;
    checked++;
    const dx = e.x - other.x;
    const dy = e.y - other.y;
    const distSq = dx * dx + dy * dy;
    const minDist = e.radius + other.radius;
    if (distSq >= minDist * minDist || distSq === 0) continue;
    const dist = Math.sqrt(distSq);
    const overlap = 1 - dist / minDist;
    pushX += (dx / dist) * overlap;
    pushY += (dy / dist) * overlap;
  }
  const scale = (SEPARATION_STRENGTH * strengthScale * dt) / Math.sqrt(e.mass);
  e.x += pushX * scale;
  e.y += pushY * scale;
}
