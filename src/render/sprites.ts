import type { EnemyKind } from '../game/enemies';
import { HUE_COUNT } from '../engine/particles';

/**
 * Every visual in the game is baked here once at boot: radial-gradient glow
 * sprites, enemy silhouettes, pickups and a digit atlas, all drawn onto
 * small offscreen canvases. The hot path then only calls drawImage —
 * ctx.shadowBlur never appears anywhere in this codebase because it forces
 * a per-call gaussian blur that costs more than the rest of the frame.
 */

export const PALETTE = {
  gold: '#e8b76a',
  goldBright: '#f6e3bd',
  ivory: '#f2ede4',
  violet: '#8b7bd8',
  teal: '#5fd3c4',
  red: '#e4574f',
  body: '#11111c',
} as const;

export interface EnemySprites {
  body: HTMLCanvasElement;
  flash: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  /** World radius the sprite was baked at (drawImage scales from this). */
  baseRadius: number;
}

export interface DigitAtlas {
  canvas: HTMLCanvasElement;
  cellW: number;
  cellH: number;
}

export interface SpriteAtlas {
  enemies: Record<EnemyKind, EnemySprites>;
  playerCore: HTMLCanvasElement;
  playerGlow: HTMLCanvasElement;
  bolt: HTMLCanvasElement;
  wisp: HTMLCanvasElement;
  ward: HTMLCanvasElement;
  gems: readonly [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement];
  ember: HTMLCanvasElement;
  magnet: HTMLCanvasElement;
  starfall: HTMLCanvasElement;
  prism: HTMLCanvasElement;
  particles: readonly HTMLCanvasElement[];
  digits: DigitAtlas;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d context unavailable');
  return [canvas, ctx];
}

/** Soft radial glow: bright core fading to transparent. */
function makeGlow(size: number, color: string, coreAlpha = 0.9): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size);
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, withAlpha(color, coreAlpha));
  grad.addColorStop(0.35, withAlpha(color, coreAlpha * 0.45));
  grad.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

type ShapeDrawer = (ctx: CanvasRenderingContext2D, r: number) => void;

const SHAPES: Record<EnemyKind, ShapeDrawer> = {
  drifter: (ctx, r) => {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  },
  mite: (ctx, r) => {
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.9, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.9, 0);
  },
  darter: (ctx, r) => {
    ctx.moveTo(r * 1.2, 0);
    ctx.lineTo(-r * 0.8, r * 0.8);
    ctx.lineTo(-r * 0.4, 0);
    ctx.lineTo(-r * 0.8, -r * 0.8);
  },
  bulwark: (ctx, r) => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  },
  splitter: (ctx, r) => {
    ctx.arc(-r * 0.35, 0, r * 0.72, 0, Math.PI * 2);
    ctx.arc(r * 0.35, 0, r * 0.72, 0, Math.PI * 2);
  },
  boss1: (ctx, r) => {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const radius = i % 2 === 0 ? r : r * 0.82;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  },
  boss2: (ctx, r) => {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const radius = i % 2 === 0 ? r : r * 0.74;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  },
};

const ENEMY_TINT: Record<EnemyKind, string> = {
  drifter: PALETTE.violet,
  mite: PALETTE.teal,
  darter: PALETTE.teal,
  bulwark: PALETTE.violet,
  splitter: PALETTE.violet,
  boss1: PALETTE.violet,
  boss2: PALETTE.violet,
};

/** Bakes body (dark silhouette + glowing rim + eyes), white flash, and glow. */
function bakeEnemy(kind: EnemyKind, baseRadius: number): EnemySprites {
  const tint = ENEMY_TINT[kind];
  const pad = 6;
  const size = Math.ceil(baseRadius * 2.6) + pad * 2;

  const drawSilhouette = (ctx: CanvasRenderingContext2D, fill: string, rim: string): void => {
    ctx.translate(size / 2, size / 2);
    ctx.beginPath();
    SHAPES[kind](ctx, baseRadius);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = rim;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Eyes: two glowing points oriented toward +x (sprites are not rotated;
    // at silhouette scale the eyes read as "facing" regardless).
    const eyeOffset = baseRadius * 0.34;
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(eyeOffset, -baseRadius * 0.22, Math.max(1.2, baseRadius * 0.12), 0, Math.PI * 2);
    ctx.arc(eyeOffset, baseRadius * 0.22, Math.max(1.2, baseRadius * 0.12), 0, Math.PI * 2);
    ctx.fill();
  };

  const [body, bodyCtx] = makeCanvas(size);
  drawSilhouette(bodyCtx, PALETTE.body, tint);

  const [flash, flashCtx] = makeCanvas(size);
  drawSilhouette(flashCtx, PALETTE.ivory, PALETTE.ivory);

  return { body, flash, glow: makeGlow(size * 1.6, tint, 0.5), baseRadius };
}

function bakeGem(color: string, r: number): HTMLCanvasElement {
  const size = Math.ceil(r * 5);
  const [canvas, ctx] = makeCanvas(size);
  const half = size / 2;
  const glow = ctx.createRadialGradient(half, half, 0, half, half, half);
  glow.addColorStop(0, withAlpha(color, 0.55));
  glow.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  ctx.translate(half, half);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.7, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.7, 0);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = PALETTE.goldBright;
  ctx.lineWidth = 1;
  ctx.stroke();
  return canvas;
}

function bakeDigits(): DigitAtlas {
  const cellW = 14;
  const cellH = 22;
  const canvas = document.createElement('canvas');
  canvas.width = cellW * 10;
  canvas.height = cellH;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d context unavailable');
  ctx.font = '700 17px ui-monospace, SFMono-Regular, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.ivory;
  for (let d = 0; d < 10; d++) {
    ctx.fillText(String(d), d * cellW + cellW / 2, cellH / 2 + 1);
  }
  return { canvas, cellW, cellH };
}

export function bakeSprites(): SpriteAtlas {
  const particles: HTMLCanvasElement[] = [];
  const particleColors = [PALETTE.gold, PALETTE.violet, PALETTE.teal, PALETTE.ivory, PALETTE.red];
  for (let i = 0; i < HUE_COUNT; i++) {
    particles.push(makeGlow(16, particleColors[i] as string, 1));
  }

  return {
    enemies: {
      drifter: bakeEnemy('drifter', 11),
      mite: bakeEnemy('mite', 7),
      darter: bakeEnemy('darter', 9),
      bulwark: bakeEnemy('bulwark', 19),
      splitter: bakeEnemy('splitter', 12),
      boss1: bakeEnemy('boss1', 40),
      boss2: bakeEnemy('boss2', 46),
    },
    playerCore: makeGlow(28, PALETTE.goldBright, 1),
    playerGlow: makeGlow(140, PALETTE.gold, 0.55),
    bolt: makeGlow(24, PALETTE.gold, 1),
    wisp: makeGlow(28, PALETTE.goldBright, 0.95),
    ward: makeGlow(26, PALETTE.gold, 1),
    gems: [bakeGem(PALETTE.teal, 4), bakeGem(PALETTE.violet, 5.5), bakeGem(PALETTE.gold, 7)],
    ember: makeGlow(36, PALETTE.red, 1),
    magnet: makeGlow(36, PALETTE.teal, 1),
    starfall: makeGlow(44, PALETTE.ivory, 1),
    prism: bakeGem(PALETTE.goldBright, 9),
    particles,
    digits: bakeDigits(),
  };
}
