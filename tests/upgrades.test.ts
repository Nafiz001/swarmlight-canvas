import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { rollUpgradeChoices, PASSIVE_MAX_LEVEL, type PassiveKind } from '../src/game/upgrades';
import { WEAPON_KINDS, WEAPON_MAX_LEVEL, type WeaponKind } from '../src/game/weapons';

const noPassives = (): Record<PassiveKind, number> => ({
  damage: 0,
  cooldown: 0,
  speed: 0,
  magnet: 0,
  maxhp: 0,
});

const maxPassives = (): Record<PassiveKind, number> => ({
  damage: PASSIVE_MAX_LEVEL,
  cooldown: PASSIVE_MAX_LEVEL,
  speed: PASSIVE_MAX_LEVEL,
  magnet: PASSIVE_MAX_LEVEL,
  maxhp: PASSIVE_MAX_LEVEL,
});

function choiceKey(c: ReturnType<typeof rollUpgradeChoices>[number]): string {
  switch (c.type) {
    case 'new-weapon':
      return `nw:${c.weapon}`;
    case 'weapon-level':
      return `wl:${c.weapon}`;
    case 'passive':
      return `p:${c.passive}`;
    case 'heal':
      return 'heal';
  }
}

describe('rollUpgradeChoices', () => {
  it('returns at most 3 choices with no duplicates, over many seeds', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = new Rng(seed);
      const hand = rollUpgradeChoices([{ kind: 'ember', level: 2 }], noPassives(), rng);
      expect(hand.length).toBeLessThanOrEqual(3);
      expect(hand.length).toBeGreaterThan(0);
      const keys = hand.map(choiceKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('never offers a weapon level past the cap', () => {
    const owned = [{ kind: 'ember' as WeaponKind, level: WEAPON_MAX_LEVEL }];
    for (let seed = 1; seed <= 100; seed++) {
      const hand = rollUpgradeChoices(owned, noPassives(), new Rng(seed));
      for (const c of hand) {
        if (c.type === 'weapon-level') {
          expect(c.weapon).not.toBe('ember');
          expect(c.toLevel).toBeLessThanOrEqual(WEAPON_MAX_LEVEL);
        }
      }
    }
  });

  it('never offers an already-owned weapon as new', () => {
    const owned = [
      { kind: 'ember' as WeaponKind, level: 1 },
      { kind: 'nova' as WeaponKind, level: 3 },
    ];
    for (let seed = 1; seed <= 100; seed++) {
      const hand = rollUpgradeChoices(owned, noPassives(), new Rng(seed));
      for (const c of hand) {
        if (c.type === 'new-weapon') {
          expect(['ember', 'nova']).not.toContain(c.weapon);
        }
      }
    }
  });

  it('never offers a passive past the cap', () => {
    const passives = noPassives();
    passives.damage = PASSIVE_MAX_LEVEL;
    for (let seed = 1; seed <= 100; seed++) {
      const hand = rollUpgradeChoices([{ kind: 'ember', level: 1 }], passives, new Rng(seed));
      for (const c of hand) {
        if (c.type === 'passive') {
          expect(c.passive).not.toBe('damage');
          expect(c.toLevel).toBeLessThanOrEqual(PASSIVE_MAX_LEVEL);
        }
      }
    }
  });

  it('offers only passives when all weapons are maxed', () => {
    const owned = WEAPON_KINDS.map((kind) => ({ kind, level: WEAPON_MAX_LEVEL }));
    for (let seed = 1; seed <= 50; seed++) {
      const hand = rollUpgradeChoices(owned, noPassives(), new Rng(seed));
      expect(hand.length).toBe(3);
      for (const c of hand) expect(c.type).toBe('passive');
    }
  });

  it('falls back to a single heal when everything is maxed', () => {
    const owned = WEAPON_KINDS.map((kind) => ({ kind, level: WEAPON_MAX_LEVEL }));
    const hand = rollUpgradeChoices(owned, maxPassives(), new Rng(1));
    expect(hand.length).toBe(1);
    expect(hand[0]?.type).toBe('heal');
  });

  it('shrinks the hand when fewer than 3 candidates remain', () => {
    const owned = WEAPON_KINDS.map((kind) => ({ kind, level: WEAPON_MAX_LEVEL }));
    const passives = maxPassives();
    passives.magnet = PASSIVE_MAX_LEVEL - 1; // exactly one candidate left
    const hand = rollUpgradeChoices(owned, passives, new Rng(1));
    expect(hand.length).toBe(1);
    expect(hand[0]?.type).toBe('passive');
  });

  it('weighting favors a weapon level-up over any single passive', () => {
    // One weapon-level candidate (weight 4) vs one specific passive
    // candidate (weight 2): the first pick should land on the weapon
    // roughly twice as often.
    let weaponLevelCount = 0;
    let damagePassiveCount = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const hand = rollUpgradeChoices([{ kind: 'ember', level: 1 }], noPassives(), new Rng(seed));
      const first = hand[0];
      if (first?.type === 'weapon-level') weaponLevelCount++;
      if (first?.type === 'passive' && first.passive === 'damage') damagePassiveCount++;
    }
    expect(weaponLevelCount).toBeGreaterThan(damagePassiveCount * 1.3);
  });

  it('is deterministic for a given seed', () => {
    const a = rollUpgradeChoices([{ kind: 'ember', level: 1 }], noPassives(), new Rng(777));
    const b = rollUpgradeChoices([{ kind: 'ember', level: 1 }], noPassives(), new Rng(777));
    expect(a.map(choiceKey)).toEqual(b.map(choiceKey));
  });
});
