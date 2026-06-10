import type { Rng } from '../engine/rng';
import { WEAPONS, WEAPON_KINDS, WEAPON_MAX_LEVEL, type WeaponKind } from './weapons';

export type PassiveKind = 'damage' | 'cooldown' | 'speed' | 'magnet' | 'maxhp';

export const PASSIVE_MAX_LEVEL = 5;

export interface PassiveDef {
  name: string;
  describe: (toLevel: number) => string;
}

export const PASSIVES: Record<PassiveKind, PassiveDef> = {
  damage: { name: 'Kindled Fury', describe: () => '+12% damage to all weapons' },
  cooldown: { name: 'Quickened Wick', describe: () => 'Weapons fire ~9% faster' },
  speed: { name: 'Fleet Flame', describe: () => '+8% movement speed' },
  magnet: { name: 'Drawing Light', describe: () => '+34 px gem attraction radius' },
  maxhp: { name: 'Deeper Reservoir', describe: () => '+20 max HP, heal 20' },
};

export type UpgradeChoice =
  | { type: 'new-weapon'; weapon: WeaponKind; title: string; detail: string }
  | { type: 'weapon-level'; weapon: WeaponKind; toLevel: number; title: string; detail: string }
  | { type: 'passive'; passive: PassiveKind; toLevel: number; title: string; detail: string }
  | { type: 'heal'; title: string; detail: string };

interface Candidate {
  choice: UpgradeChoice;
  weight: number;
}

const WEIGHT_WEAPON_LEVEL = 4;
const WEIGHT_NEW_WEAPON = 3;
const WEIGHT_PASSIVE = 2;

/**
 * Rolls a hand of up to `handSize` distinct upgrade choices.
 *
 * - Never offers a weapon or passive past its level cap.
 * - Never offers the same weapon/passive twice in one hand (each candidate
 *   appears once in the pool; sampling is without replacement).
 * - Weighted: leveling an owned weapon > a new weapon > a passive.
 * - When every pool is exhausted, falls back to a single heal so the
 *   level-up flow never dead-ends.
 */
export function rollUpgradeChoices(
  ownedWeapons: ReadonlyArray<{ kind: WeaponKind; level: number }>,
  passives: Readonly<Record<PassiveKind, number>>,
  rng: Rng,
  handSize = 3,
): UpgradeChoice[] {
  const candidates: Candidate[] = [];

  for (const owned of ownedWeapons) {
    if (owned.level >= WEAPON_MAX_LEVEL) continue;
    const def = WEAPONS[owned.kind];
    candidates.push({
      weight: WEIGHT_WEAPON_LEVEL,
      choice: {
        type: 'weapon-level',
        weapon: owned.kind,
        toLevel: owned.level + 1,
        title: `${def.name} Lv ${owned.level + 1}`,
        detail: def.tagline,
      },
    });
  }

  for (const kind of WEAPON_KINDS) {
    if (ownedWeapons.some((w) => w.kind === kind)) continue;
    const def = WEAPONS[kind];
    candidates.push({
      weight: WEIGHT_NEW_WEAPON,
      choice: { type: 'new-weapon', weapon: kind, title: def.name, detail: def.tagline },
    });
  }

  for (const key of Object.keys(PASSIVES) as PassiveKind[]) {
    const level = passives[key];
    if (level >= PASSIVE_MAX_LEVEL) continue;
    const def = PASSIVES[key];
    candidates.push({
      weight: WEIGHT_PASSIVE,
      choice: {
        type: 'passive',
        passive: key,
        toLevel: level + 1,
        title: `${def.name} Lv ${level + 1}`,
        detail: def.describe(level + 1),
      },
    });
  }

  if (candidates.length === 0) {
    return [{ type: 'heal', title: 'Rekindle', detail: 'Restore 25% of max HP' }];
  }

  // Weighted sampling without replacement.
  const hand: UpgradeChoice[] = [];
  while (hand.length < handSize && candidates.length > 0) {
    let total = 0;
    for (const c of candidates) total += c.weight;
    let roll = rng.next() * total;
    let picked = candidates.length - 1;
    for (let i = 0; i < candidates.length; i++) {
      roll -= (candidates[i] as Candidate).weight;
      if (roll <= 0) {
        picked = i;
        break;
      }
    }
    hand.push((candidates[picked] as Candidate).choice);
    candidates.splice(picked, 1);
  }
  return hand;
}
