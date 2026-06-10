import type { Rng } from '../engine/rng';
import type { SpatialHash } from '../engine/spatialHash';
import type { Enemy } from './enemies';
import type { PlayerState } from './player';

export type WeaponKind = 'ember' | 'orbit' | 'nova' | 'wisp' | 'arc';

export const WEAPON_KINDS: readonly WeaponKind[] = ['ember', 'orbit', 'nova', 'wisp', 'arc'];

export const WEAPON_MAX_LEVEL = 5;

export interface WeaponLevelStats {
  damage: number;
  cooldown: number;
  /** Bolts per volley / orbiting wards / wisps per volley / arc chain length. */
  count: number;
  pierce: number;
  /** Targeting range, nova radius, or arc first-jump range. */
  range: number;
  /** Projectile speed (where applicable). */
  speed: number;
}

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  tagline: string;
  levels: readonly WeaponLevelStats[];
}

const L = (
  damage: number,
  cooldown: number,
  count: number,
  pierce: number,
  range: number,
  speed: number,
): WeaponLevelStats => ({ damage, cooldown, count, pierce, range, speed });

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  ember: {
    kind: 'ember',
    name: 'Ember Bolt',
    tagline: 'Piercing bolt seeking the nearest shadow',
    levels: [
      L(9, 0.85, 1, 1, 420, 520),
      L(12, 0.75, 1, 2, 440, 540),
      L(15, 0.65, 2, 2, 460, 560),
      L(19, 0.55, 2, 3, 480, 580),
      L(24, 0.45, 3, 4, 500, 600),
    ],
  },
  orbit: {
    kind: 'orbit',
    name: 'Orbit Wards',
    tagline: 'Motes of flame circling the lantern',
    levels: [
      L(7, 0.5, 2, 0, 70, 2.4),
      L(9, 0.46, 3, 0, 76, 2.6),
      L(12, 0.42, 4, 0, 82, 2.8),
      L(15, 0.38, 5, 0, 88, 3.1),
      L(19, 0.34, 6, 0, 96, 3.4),
    ],
  },
  nova: {
    kind: 'nova',
    name: 'Nova Pulse',
    tagline: 'A breath of light that scours the dark',
    levels: [
      L(12, 3.2, 0, 0, 110, 0),
      L(16, 2.9, 0, 0, 128, 0),
      L(21, 2.6, 0, 0, 146, 0),
      L(27, 2.2, 0, 0, 165, 0),
      L(34, 1.8, 0, 0, 190, 0),
    ],
  },
  wisp: {
    kind: 'wisp',
    name: 'Seeker Wisps',
    tagline: 'Slow lights that will not be refused',
    levels: [
      L(8, 1.7, 1, 1, 340, 200),
      L(10, 1.55, 2, 1, 340, 210),
      L(13, 1.4, 2, 2, 360, 220),
      L(16, 1.2, 3, 2, 380, 235),
      L(21, 1.0, 4, 3, 400, 250),
    ],
  },
  arc: {
    kind: 'arc',
    name: 'Arc Lash',
    tagline: 'Lightning that leaps from shadow to shadow',
    levels: [
      L(10, 2.4, 3, 0, 240, 0),
      L(13, 2.2, 4, 0, 250, 0),
      L(16, 2.0, 5, 0, 260, 0),
      L(20, 1.7, 6, 0, 275, 0),
      L(25, 1.4, 7, 0, 290, 0),
    ],
  },
};

export interface WeaponState {
  kind: WeaponKind;
  level: number;
  /** Time until the next volley. */
  timer: number;
  /** Orbit angle for wards. */
  angle: number;
}

export function statsFor(kind: WeaponKind, level: number): WeaponLevelStats {
  const levels = WEAPONS[kind].levels;
  const i = Math.min(Math.max(level, 1), levels.length) - 1;
  return levels[i] as WeaponLevelStats;
}

/** Wisp homing turn rate (rad/s) and arc jump search radius (px). */
export const WISP_TURN_RATE = 4.5;
export const ARC_JUMP_RANGE = 140;
export const ARC_DAMAGE_FALLOFF = 0.85;
export const ORBIT_HIT_INTERVAL = 0.45;

/**
 * The mutation surface weapons need from the world. Game implements this;
 * keeping it an interface lets weapon logic live here without importing the
 * orchestrator (no runtime cycle, tests stay narrow).
 */
export interface CombatWorld {
  readonly rng: Rng;
  readonly time: number;
  readonly player: PlayerState;
  readonly hash: SpatialHash;
  /** Scratch buffer reused for hash queries; valid until the next query. */
  readonly queryBuf: number[];
  enemyAt(id: number): Enemy;
  fireBolt(
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    pierce: number,
    range: number,
  ): void;
  fireWisp(x: number, y: number, angle: number, speed: number, damage: number, pierce: number): void;
  damageEnemy(e: Enemy, amount: number, kbX: number, kbY: number): void;
  novaBurst(x: number, y: number, radius: number, damage: number): void;
  arcStrike(fromX: number, fromY: number, range: number, chains: number, damage: number): void;
  onWeaponFired(kind: WeaponKind): void;
}

/** Returns the id of the nearest enemy within `range` of (x, y), or -1. */
export function nearestEnemy(world: CombatWorld, x: number, y: number, range: number): number {
  world.hash.queryCircle(x, y, range, world.queryBuf);
  let best = -1;
  let bestDistSq = Infinity;
  for (let i = 0; i < world.queryBuf.length; i++) {
    const id = world.queryBuf[i] as number;
    const e = world.enemyAt(id);
    const dx = e.x - x;
    const dy = e.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestDistSq) {
      bestDistSq = d;
      best = id;
    }
  }
  return best;
}

/** Advances one weapon: cooldowns, volleys, and continuous effects (orbit). */
export function updateWeapon(
  world: CombatWorld,
  w: WeaponState,
  damageMult: number,
  cooldownMult: number,
  dt: number,
): void {
  const stats = statsFor(w.kind, w.level);
  const player = world.player;

  if (w.kind === 'orbit') {
    // Continuous: wards orbit and hit on an interval rather than a cooldown.
    w.angle += stats.speed * dt;
    const damage = stats.damage * damageMult;
    for (let i = 0; i < stats.count; i++) {
      const a = w.angle + (i * Math.PI * 2) / stats.count;
      const wx = player.x + Math.cos(a) * stats.range;
      const wy = player.y + Math.sin(a) * stats.range;
      world.hash.queryCircle(wx, wy, 13, world.queryBuf);
      for (let j = 0; j < world.queryBuf.length; j++) {
        const e = world.enemyAt(world.queryBuf[j] as number);
        if (world.time - e.lastOrbitHit < ORBIT_HIT_INTERVAL * cooldownMult) continue;
        e.lastOrbitHit = world.time;
        const dist = Math.hypot(e.x - wx, e.y - wy) || 1;
        world.damageEnemy(e, damage, ((e.x - wx) / dist) * 90, ((e.y - wy) / dist) * 90);
      }
    }
    return;
  }

  w.timer -= dt;
  if (w.timer > 0) return;

  const damage = stats.damage * damageMult;

  switch (w.kind) {
    case 'ember': {
      const target = nearestEnemy(world, player.x, player.y, stats.range);
      if (target < 0) {
        w.timer = 0.1; // nothing in range; retry soon without burning the cooldown
        return;
      }
      const e = world.enemyAt(target);
      const base = Math.atan2(e.y - player.y, e.x - player.x);
      const spread = 0.14;
      for (let i = 0; i < stats.count; i++) {
        const offset = (i - (stats.count - 1) / 2) * spread;
        world.fireBolt(player.x, player.y, base + offset, stats.speed, damage, stats.pierce, stats.range);
      }
      break;
    }
    case 'wisp': {
      for (let i = 0; i < stats.count; i++) {
        const angle = world.rng.next() * Math.PI * 2;
        world.fireWisp(player.x, player.y, angle, stats.speed, damage, stats.pierce);
      }
      break;
    }
    case 'nova': {
      world.novaBurst(player.x, player.y, stats.range, damage);
      break;
    }
    case 'arc': {
      world.arcStrike(player.x, player.y, stats.range, stats.count, damage);
      break;
    }
    default:
      break;
  }

  world.onWeaponFired(w.kind);
  w.timer = stats.cooldown * cooldownMult;
}
