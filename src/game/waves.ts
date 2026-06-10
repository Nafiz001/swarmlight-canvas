import type { Rng } from '../engine/rng';
import type { EnemyKind } from './enemies';

export const RUN_DURATION = 600; // 10:00

export interface WavePhase {
  from: number;
  to: number;
  /** Seconds between spawn ticks. */
  interval: number;
  /** Enemies spawned per tick. */
  pack: number;
  weights: ReadonlyArray<readonly [EnemyKind, number]>;
}

/**
 * The whole difficulty curve is this table: contiguous phases with rising
 * spawn rate and a shifting enemy mix. Spawn rate (pack / interval) is
 * non-decreasing across phases — verified by tests.
 */
export const WAVE_TABLE: readonly WavePhase[] = [
  { from: 0, to: 45, interval: 0.3, pack: 1, weights: [['drifter', 3], ['mite', 1]] },
  { from: 45, to: 110, interval: 0.42, pack: 2, weights: [['drifter', 4], ['mite', 2]] },
  {
    from: 110,
    to: 180,
    interval: 0.32,
    pack: 2,
    weights: [['drifter', 4], ['mite', 3], ['darter', 1]],
  },
  {
    from: 180,
    to: 270,
    interval: 0.36,
    pack: 3,
    weights: [['drifter', 4], ['mite', 3], ['darter', 2], ['bulwark', 1]],
  },
  {
    from: 270,
    to: 360,
    interval: 0.28,
    pack: 3,
    weights: [['drifter', 4], ['mite', 4], ['darter', 2], ['bulwark', 1], ['splitter', 2]],
  },
  {
    from: 360,
    to: 450,
    interval: 0.3,
    pack: 4,
    weights: [['drifter', 4], ['mite', 5], ['darter', 3], ['bulwark', 2], ['splitter', 2]],
  },
  {
    from: 450,
    to: 540,
    interval: 0.24,
    pack: 4,
    weights: [['drifter', 3], ['mite', 6], ['darter', 3], ['bulwark', 2], ['splitter', 3]],
  },
  {
    from: 540,
    to: 600,
    interval: 0.16,
    pack: 4,
    weights: [['drifter', 3], ['mite', 6], ['darter', 4], ['bulwark', 3], ['splitter', 3]],
  },
];

export interface SurgeEvent {
  t: number;
  label: string;
  kind: EnemyKind;
  count: number;
}

export const SURGES: readonly SurgeEvent[] = [
  { t: 2, label: 'The dark stirs', kind: 'mite', count: 12 },
  { t: 25, label: 'Embers on the wind', kind: 'mite', count: 18 },
  { t: 90, label: 'Mite swarm', kind: 'mite', count: 48 },
  { t: 215, label: 'Darter pack', kind: 'darter', count: 16 },
  { t: 335, label: 'The walls close in', kind: 'drifter', count: 60 },
  { t: 455, label: 'Splinter tide', kind: 'splitter', count: 24 },
  { t: 530, label: 'Last hour of dark', kind: 'mite', count: 80 },
];

export interface BossEvent {
  t: number;
  kind: EnemyKind;
  name: string;
}

export const BOSSES: readonly BossEvent[] = [
  { t: 300, kind: 'boss1', name: 'Maw of Hollow' },
  { t: 570, kind: 'boss2', name: 'The Unlit King' },
];

export function phaseAt(t: number): WavePhase {
  for (let i = WAVE_TABLE.length - 1; i >= 0; i--) {
    const phase = WAVE_TABLE[i] as WavePhase;
    if (t >= phase.from) return phase;
  }
  return WAVE_TABLE[0] as WavePhase;
}

/** Sustained spawn rate (enemies per second) at time t. */
export function spawnRateAt(t: number): number {
  const phase = phaseAt(t);
  return phase.pack / phase.interval;
}

export function pickEnemyKind(t: number, rng: Rng): EnemyKind {
  const { weights } = phaseAt(t);
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += (weights[i] as readonly [EnemyKind, number])[1];
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    const entry = weights[i] as readonly [EnemyKind, number];
    roll -= entry[1];
    if (roll <= 0) return entry[0];
  }
  return (weights[weights.length - 1] as readonly [EnemyKind, number])[0];
}

/** Enemy HP multiplier; reaches ~8x by 10:00. */
export function hpScaleAt(t: number): number {
  return 1 + t / 85;
}

/** Enemy speed multiplier, capped so late waves stay dodgeable. */
export function speedScaleAt(t: number): number {
  return Math.min(1.5, 1 + (t / 600) * 0.55);
}

/** Chance that a non-boss spawn rolls elite; rises after the first minute. */
export function eliteChanceAt(t: number): number {
  return t < 75 ? 0 : Math.min(0.02, 0.004 + (t / 600) * 0.018);
}
