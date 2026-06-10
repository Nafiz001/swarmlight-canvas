import { describe, expect, it } from 'vitest';
import { HUE, ParticleSystem } from '../src/engine/particles';

describe('ParticleSystem', () => {
  it('spawn writes fields at the next free index and increments count', () => {
    const ps = new ParticleSystem(8);
    ps.spawn(1, 2, 3, 4, 0.5, 2.5, HUE.teal, 1.5);
    expect(ps.count).toBe(1);
    expect(ps.x[0]).toBe(1);
    expect(ps.y[0]).toBe(2);
    expect(ps.vx[0]).toBe(3);
    expect(ps.vy[0]).toBe(4);
    expect(ps.life[0]).toBe(0.5);
    expect(ps.maxLife[0]).toBe(0.5);
    expect(ps.size[0]).toBe(2.5);
    expect(ps.hue[0]).toBe(HUE.teal);
    expect(ps.drag[0]).toBe(1.5);
  });

  it('update integrates position, decays life, and applies drag damping', () => {
    const ps = new ParticleSystem(8);
    ps.spawn(0, 0, 10, 0, 1, 1, HUE.gold, 0); // zero drag: velocity unchanged
    ps.update(0.5);
    expect(ps.count).toBe(1);
    expect(ps.x[0]).toBeCloseTo(5);
    expect(ps.vx[0]).toBeCloseTo(10);
    expect(ps.life[0]).toBeCloseTo(0.5);

    const damped = new ParticleSystem(8);
    damped.spawn(0, 0, 10, 0, 1, 1, HUE.gold, 2);
    damped.update(0.1);
    expect(damped.vx[0]).toBeCloseTo(8); // 10 * (1 - 2 * 0.1)
  });

  it('swap-removes expired particles and re-examines the swapped-in slot', () => {
    const ps = new ParticleSystem(8);
    // A and B expire this step; C survives. Sizes identify the survivors.
    ps.spawn(0, 0, 0, 0, 0.01, 1, HUE.gold, 0); // A
    ps.spawn(0, 0, 0, 0, 0.01, 2, HUE.gold, 0); // B
    ps.spawn(0, 0, 0, 0, 1.0, 3, HUE.gold, 0); // C
    ps.update(0.02);
    // A dies -> C swapped into slot 0 and re-examined (alive); B dies in place.
    expect(ps.count).toBe(1);
    expect(ps.size[0]).toBe(3);
  });

  it('removes a swapped-in particle that is itself already expired', () => {
    const ps = new ParticleSystem(8);
    ps.spawn(0, 0, 0, 0, 1.0, 1, HUE.gold, 0); // A survives
    ps.spawn(0, 0, 0, 0, 0.01, 2, HUE.gold, 0); // B dies
    ps.spawn(0, 0, 0, 0, 0.01, 3, HUE.gold, 0); // C dies, gets swapped onto B
    ps.update(0.02);
    expect(ps.count).toBe(1);
    expect(ps.size[0]).toBe(1);
  });

  it('drops spawns at capacity instead of growing or overwriting', () => {
    const ps = new ParticleSystem(4);
    for (let i = 0; i < 10; i++) ps.spawn(i, 0, 0, 0, 1, i + 1, HUE.gold, 0);
    expect(ps.count).toBe(4);
    expect(ps.size[3]).toBe(4); // the fifth spawn did not clobber slot 3
  });

  it('clear resets the live count', () => {
    const ps = new ParticleSystem(8);
    ps.spawn(0, 0, 0, 0, 1, 1, HUE.gold, 0);
    ps.clear();
    expect(ps.count).toBe(0);
  });
});
