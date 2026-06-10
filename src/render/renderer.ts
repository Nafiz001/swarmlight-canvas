import type { Game } from '../game/game';
import type { JoystickState } from '../engine/input';
import { DART, DART_WINDUP } from '../game/enemies';
import { statsFor } from '../game/weapons';
import { bakeSprites, PALETTE, type SpriteAtlas } from './sprites';

const MAX_DPR = 2;
const CULL_MARGIN = 64;

/**
 * All world rendering happens in two batched passes per layer group:
 * silhouettes with default compositing, then every glow with a single
 * switch to 'lighter'. Sprites come from the boot-time atlas; the only
 * geometry drawn per-frame is starfield dust, shockwave rings and arc
 * polylines (a handful of strokes).
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: SpriteAtlas;
  private vignette: HTMLCanvasElement | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private camX = 0;
  private camY = 0;
  private shakeSeed = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly game: Game,
    private readonly joystick: JoystickState,
  ) {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.sprites = bakeSprites();
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = Math.min(dpr, MAX_DPR);
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.bakeVignette();
  }

  render(alpha: number, frameDt: number): void {
    const { ctx, game } = this;
    const p = game.player;

    // Interpolate the followed position between sim steps; with a fixed
    // 60 Hz sim this only matters on high-refresh displays and slow-mo.
    const px = p.prevX + (p.x - p.prevX) * alpha;
    const py = p.prevY + (p.y - p.prevY) * alpha;
    const follow = 1 - Math.pow(0.0001, frameDt);
    this.camX += (px - this.camX) * follow;
    this.camY += (py - this.camY) * follow;

    this.shakeSeed += frameDt * 60;
    const shakeX = game.shake > 0 ? Math.sin(this.shakeSeed * 2.7) * game.shake : 0;
    const shakeY = game.shake > 0 ? Math.cos(this.shakeSeed * 3.3) * game.shake : 0;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, this.width, this.height);

    const viewX = this.camX + shakeX - this.width / 2;
    const viewY = this.camY + shakeY - this.height / 2;
    ctx.translate(-viewX, -viewY);

    this.drawStarfield(viewX, viewY, 0.35, 150, 0.2);
    this.drawStarfield(viewX, viewY, 0.65, 105, 0.32);

    const minX = viewX - CULL_MARGIN;
    const minY = viewY - CULL_MARGIN;
    const maxX = viewX + this.width + CULL_MARGIN;
    const maxY = viewY + this.height + CULL_MARGIN;

    this.drawPickups(minX, minY, maxX, maxY);
    this.drawEnemyBodies(minX, minY, maxX, maxY);
    this.drawPlayerCore(px, py);

    // Single composite switch for every glow in the scene.
    ctx.globalCompositeOperation = 'lighter';
    this.drawEnemyGlows(minX, minY, maxX, maxY);
    this.drawPlayerGlow(px, py);
    this.drawWards(px, py);
    this.drawProjectiles(minX, minY, maxX, maxY);
    this.drawParticles(minX, minY, maxX, maxY);
    this.drawEffects();
    ctx.globalCompositeOperation = 'source-over';

    this.drawDamageNumbers(minX, minY, maxX, maxY);

    ctx.translate(viewX, viewY);
    this.drawOverlays();
    this.drawJoystick();
  }

  /**
   * Unbounded procedural dust: each grid cell hashes its integer coords to a
   * deterministic offset/brightness, so the field is infinite with zero
   * storage and parallax is just a scaled camera.
   */
  private drawStarfield(
    viewX: number,
    viewY: number,
    parallax: number,
    cell: number,
    alpha: number,
  ): void {
    const { ctx } = this;
    const ox = viewX * parallax;
    const oy = viewY * parallax;
    const startX = Math.floor(ox / cell);
    const endX = Math.floor((ox + this.width) / cell);
    const startY = Math.floor(oy / cell);
    const endY = Math.floor((oy + this.height) / cell);
    ctx.fillStyle = PALETTE.ivory;
    for (let cy = startY; cy <= endY; cy++) {
      for (let cx = startX; cx <= endX; cx++) {
        let h = (cx * 374761393 + cy * 668265263) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        if ((h & 7) > 2) continue; // ~37% of cells hold a mote
        const jx = ((h >>> 4) & 63) / 63;
        const jy = ((h >>> 10) & 63) / 63;
        const size = 1 + ((h >>> 16) & 1);
        ctx.globalAlpha = alpha * (0.4 + ((h >>> 18) & 31) / 52);
        ctx.fillRect(cx * cell + jx * cell - ox + viewX, cy * cell + jy * cell - oy + viewY, size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPickups(minX: number, minY: number, maxX: number, maxY: number): void {
    const { ctx, game } = this;
    const s = this.sprites;
    for (let i = 0; i < game.pickups.liveCount; i++) {
      const g = game.pickups.at(i);
      if (g.x < minX || g.x > maxX || g.y < minY || g.y > maxY) continue;
      const bobY = Math.sin(g.bob * 3) * 2.5;
      let sprite: HTMLCanvasElement;
      switch (g.kind) {
        case 'gem1': sprite = s.gems[0]; break;
        case 'gem2': sprite = s.gems[1]; break;
        case 'gem3': sprite = s.gems[2]; break;
        case 'ember': sprite = s.ember; break;
        case 'magnet': sprite = s.magnet; break;
        case 'starfall': sprite = s.starfall; break;
        case 'prism': sprite = s.prism; break;
      }
      ctx.drawImage(sprite, g.x - sprite.width / 2, g.y + bobY - sprite.height / 2);
    }
  }

  private drawEnemyBodies(minX: number, minY: number, maxX: number, maxY: number): void {
    const { ctx, game } = this;
    for (let i = 0; i < game.enemies.liveCount; i++) {
      const e = game.enemies.at(i);
      if (e.x < minX || e.x > maxX || e.y < minY || e.y > maxY) continue;
      const sp = this.sprites.enemies[e.kind];
      const scale = e.radius / sp.baseRadius;
      const w = sp.body.width * scale;
      ctx.drawImage(sp.body, e.x - w / 2, e.y - w / 2, w, w);
      if (e.hitFlash > 0) {
        ctx.globalAlpha = e.hitFlash;
        ctx.drawImage(sp.flash, e.x - w / 2, e.y - w / 2, w, w);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawEnemyGlows(minX: number, minY: number, maxX: number, maxY: number): void {
    const { ctx, game } = this;
    for (let i = 0; i < game.enemies.liveCount; i++) {
      const e = game.enemies.at(i);
      if (e.x < minX || e.x > maxX || e.y < minY || e.y > maxY) continue;
      const sp = this.sprites.enemies[e.kind];
      let scale = (e.radius / sp.baseRadius) * (e.elite ? 1.5 : 1);
      let glowAlpha = 0.65;
      if (e.kind === 'darter' && e.phase === DART.windup) {
        // Telegraph: glow swells during the wind-up so the dash reads early.
        const t = 1 - e.phaseTimer / DART_WINDUP;
        scale *= 1 + t * 0.9;
        glowAlpha = 0.65 + t * 0.35;
      }
      const w = sp.glow.width * scale;
      ctx.globalAlpha = glowAlpha;
      ctx.drawImage(sp.glow, e.x - w / 2, e.y - w / 2, w, w);
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayerCore(px: number, py: number): void {
    const { ctx } = this;
    const flicker = 1 + Math.sin(this.shakeSeed * 0.31) * 0.06;
    const core = this.sprites.playerCore;
    const w = core.width * flicker;
    ctx.drawImage(core, px - w / 2, py - w / 2, w, w);
  }

  private drawPlayerGlow(px: number, py: number): void {
    const { ctx, game } = this;
    const flicker = 1 + Math.sin(this.shakeSeed * 0.47) * 0.07;
    const glow = this.sprites.playerGlow;
    const w = glow.width * flicker;
    ctx.globalAlpha = game.player.iframes > 0 ? 0.45 + Math.sin(this.shakeSeed * 1.8) * 0.25 : 0.85;
    ctx.drawImage(glow, px - w / 2, py - w / 2, w, w);
    ctx.globalAlpha = 1;
  }

  private drawWards(px: number, py: number): void {
    const { ctx, game } = this;
    for (let wi = 0; wi < game.weapons.length; wi++) {
      const w = game.weapons[wi];
      if (w === undefined || w.kind !== 'orbit') continue;
      const stats = statsFor('orbit', w.level);
      const sprite = this.sprites.ward;
      for (let i = 0; i < stats.count; i++) {
        const a = w.angle + (i * Math.PI * 2) / stats.count;
        const wx = px + Math.cos(a) * stats.range;
        const wy = py + Math.sin(a) * stats.range;
        ctx.drawImage(sprite, wx - sprite.width / 2, wy - sprite.height / 2);
      }
    }
  }

  private drawProjectiles(minX: number, minY: number, maxX: number, maxY: number): void {
    const { ctx, game } = this;
    for (let i = 0; i < game.projectiles.liveCount; i++) {
      const p = game.projectiles.at(i);
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      const sprite = p.kind === 'bolt' ? this.sprites.bolt : this.sprites.wisp;
      ctx.drawImage(sprite, p.x - sprite.width / 2, p.y - sprite.height / 2);
    }
  }

  private drawParticles(minX: number, minY: number, maxX: number, maxY: number): void {
    const { ctx, game } = this;
    const ps = game.particles;
    const sprites = this.sprites.particles;
    for (let i = 0; i < ps.count; i++) {
      const x = ps.x[i] as number;
      const y = ps.y[i] as number;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const sprite = sprites[ps.hue[i] as number] as HTMLCanvasElement;
      const lifeRatio = (ps.life[i] as number) / (ps.maxLife[i] as number);
      const size = (ps.size[i] as number) * 4 * (0.5 + lifeRatio * 0.5);
      ctx.globalAlpha = lifeRatio;
      ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  private drawEffects(): void {
    const { ctx, game } = this;
    const waves = game.effects.waves;
    for (let i = 0; i < waves.liveCount; i++) {
      const w = waves.at(i);
      const t = 1 - w.life / w.maxLife;
      const radius = w.maxRadius * (0.2 + 0.8 * t);
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = w.tint === 0 ? PALETTE.gold : PALETTE.ivory;
      ctx.lineWidth = 3 + (1 - t) * 5;
      ctx.beginPath();
      ctx.arc(w.x, w.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    const arcs = game.effects.arcs;
    for (let i = 0; i < arcs.liveCount; i++) {
      const a = arcs.at(i);
      if (a.count < 2) continue;
      const t = a.life / a.maxLife;
      // Wide soft pass then a bright core pass: a glowing polyline without shadowBlur.
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = pass === 0 ? t * 0.35 : t;
        ctx.strokeStyle = pass === 0 ? PALETTE.teal : PALETTE.ivory;
        ctx.lineWidth = pass === 0 ? 7 : 2;
        ctx.beginPath();
        ctx.moveTo(a.points[0] as number, a.points[1] as number);
        for (let j = 1; j < a.count; j++) {
          ctx.lineTo(a.points[j * 2] as number, a.points[j * 2 + 1] as number);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawDamageNumbers(minX: number, minY: number, maxX: number, maxY: number): void {
    const { ctx, game } = this;
    const { canvas, cellW, cellH } = this.sprites.digits;
    const pool = game.damageNumbers.pool;
    for (let i = 0; i < pool.liveCount; i++) {
      const n = pool.at(i);
      if (n.x < minX || n.x > maxX || n.y < minY || n.y > maxY) continue;
      ctx.globalAlpha = Math.min(1, (n.life / n.maxLife) * 2);
      // Digits are blitted from the atlas; extracting them numerically
      // avoids a toString() allocation per number per frame.
      let value = n.value;
      let digits = 1;
      for (let v = value; v >= 10; v = Math.floor(v / 10)) digits++;
      let x = n.x + (digits * cellW * 0.62) / 2;
      while (digits > 0) {
        const d = value % 10;
        value = Math.floor(value / 10);
        x -= cellW * 0.62;
        ctx.drawImage(canvas, d * cellW, 0, cellW, cellH, x, n.y - cellH / 2, cellW, cellH);
        digits--;
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawOverlays(): void {
    const { ctx, game } = this;
    if (this.vignette !== null) ctx.drawImage(this.vignette, 0, 0, this.width, this.height);
    if (game.player.hurtPulse > 0) {
      ctx.globalAlpha = game.player.hurtPulse * 0.45;
      ctx.fillStyle = PALETTE.red;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }
  }

  private drawJoystick(): void {
    if (!this.joystick.active) return;
    const { ctx, joystick } = this;
    ctx.strokeStyle = PALETTE.ivory;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(joystick.originX, joystick.originY, 56, 0, Math.PI * 2);
    ctx.stroke();
    const dx = joystick.x - joystick.originX;
    const dy = joystick.y - joystick.originY;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, 56);
    const kx = len > 0 ? joystick.originX + (dx / len) * clamped : joystick.originX;
    const ky = len > 0 ? joystick.originY + (dy / len) * clamped : joystick.originY;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath();
    ctx.arc(kx, ky, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Static edge darkening, baked once per resize instead of per frame. */
  private bakeVignette(): void {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(this.width / 2));
    canvas.height = Math.max(1, Math.floor(this.height / 2));
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const inner = Math.min(cx, cy) * 0.7;
    const outer = Math.hypot(cx, cy);
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, 'rgba(5,5,10,0)');
    grad.addColorStop(1, 'rgba(5,5,10,0.6)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.vignette = canvas;
  }
}
