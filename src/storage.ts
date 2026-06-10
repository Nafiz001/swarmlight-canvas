const KEY = 'swarmlight.v1';

export interface BestStats {
  bestTime: number;
  bestKills: number;
  bestLevel: number;
  victories: number;
  runs: number;
}

const DEFAULTS: BestStats = { bestTime: 0, bestKills: 0, bestLevel: 0, victories: 0, runs: 0 };

export function loadBest(): BestStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULTS };
    const p = parsed as Partial<Record<keyof BestStats, unknown>>;
    return {
      bestTime: asNumber(p.bestTime),
      bestKills: asNumber(p.bestKills),
      bestLevel: asNumber(p.bestLevel),
      victories: asNumber(p.victories),
      runs: asNumber(p.runs),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function recordRun(time: number, kills: number, level: number, won: boolean): BestStats {
  const best = loadBest();
  best.bestTime = Math.max(best.bestTime, time);
  best.bestKills = Math.max(best.bestKills, kills);
  best.bestLevel = Math.max(best.bestLevel, level);
  best.runs += 1;
  if (won) best.victories += 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(best));
  } catch {
    /* private mode or quota: stats just don't persist */
  }
  return best;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
