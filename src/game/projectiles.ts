import type { Poolable } from '../engine/pool';

export type ProjectileKind = 'bolt' | 'wisp';

export interface Projectile extends Poolable {
  kind: ProjectileKind;
  /** Unique id, compared against Enemy.lastHitUid to prevent re-hits. */
  uid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  /** Remaining enemies this projectile may pass through. */
  pierce: number;
  life: number;
  /** Max speed (wisps steer at constant speed). */
  speed: number;
  /** Homing turn rate in rad/s (0 = ballistic). */
  turnRate: number;
}

export function createProjectile(): Projectile {
  return {
    poolIndex: -1,
    kind: 'bolt',
    uid: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 4,
    damage: 0,
    pierce: 1,
    life: 0,
    speed: 0,
    turnRate: 0,
  };
}

/** Rotates velocity toward (tx, ty) at the projectile's turn rate. */
export function steerToward(p: Projectile, tx: number, ty: number, dt: number): void {
  const desired = Math.atan2(ty - p.y, tx - p.x);
  const current = Math.atan2(p.vy, p.vx);
  let delta = desired - current;
  // Wrap to [-PI, PI] so the wisp always turns the short way.
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  const maxTurn = p.turnRate * dt;
  if (delta > maxTurn) delta = maxTurn;
  else if (delta < -maxTurn) delta = -maxTurn;
  const angle = current + delta;
  p.vx = Math.cos(angle) * p.speed;
  p.vy = Math.sin(angle) * p.speed;
}
