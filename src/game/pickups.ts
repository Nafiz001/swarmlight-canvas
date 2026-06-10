import type { Poolable } from '../engine/pool';

export type PickupKind = 'gem1' | 'gem2' | 'gem3' | 'ember' | 'magnet' | 'starfall' | 'prism';

export interface Pickup extends Poolable {
  kind: PickupKind;
  x: number;
  y: number;
  /** XP value (gems only). */
  value: number;
  /** True once magnet attraction has latched on; never lets go. */
  magnetized: boolean;
  /** Current attraction speed; ramps up while magnetized. */
  pullSpeed: number;
  /** Phase offset for the idle bobbing animation. */
  bob: number;
}

export const GEM_VALUES = { gem1: 1, gem2: 5, gem3: 25 } as const;

export function createPickup(): Pickup {
  return {
    poolIndex: -1,
    kind: 'gem1',
    x: 0,
    y: 0,
    value: 0,
    magnetized: false,
    pullSpeed: 0,
    bob: 0,
  };
}

/** Chooses the gem tier whose value fits the dropped XP amount. */
export function gemTierFor(xp: number): PickupKind {
  if (xp >= GEM_VALUES.gem3) return 'gem3';
  if (xp >= GEM_VALUES.gem2) return 'gem2';
  return 'gem1';
}
