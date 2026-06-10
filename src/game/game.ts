import { ParticleSystem, HUE } from '../engine/particles';
import { Pool } from '../engine/pool';
import { Rng } from '../engine/rng';
import { SpatialHash } from '../engine/spatialHash';
import { DamageNumbers } from './damageNumbers';
import { Effects, ARC_MAX_POINTS } from './effects';
import {
  applySeparation,
  createEnemy,
  initEnemy,
  updateEnemySteering,
  type Enemy,
  type EnemyKind,
} from './enemies';
import { createPickup, gemTierFor, GEM_VALUES, type Pickup, type PickupKind } from './pickups';
import {
  createPlayer,
  cooldownMultiplier,
  damageMultiplier,
  grantXp,
  magnetRadius,
  moveSpeed,
  IFRAME_DURATION,
  type PlayerState,
} from './player';
import { createProjectile, steerToward, type Projectile } from './projectiles';
import {
  PASSIVE_MAX_LEVEL,
  rollUpgradeChoices,
  type UpgradeChoice,
} from './upgrades';
import {
  ARC_DAMAGE_FALLOFF,
  ARC_JUMP_RANGE,
  nearestEnemy,
  updateWeapon,
  WISP_TURN_RATE,
  type CombatWorld,
  type WeaponKind,
  type WeaponState,
} from './weapons';
import {
  BOSSES,
  eliteChanceAt,
  hpScaleAt,
  phaseAt,
  pickEnemyKind,
  RUN_DURATION,
  speedScaleAt,
  SURGES,
} from './waves';
import type { InputFrame } from '../engine/input';

export type Phase = 'title' | 'running' | 'levelup' | 'paused' | 'gameover' | 'victory';

export interface GameEvents {
  onWeaponFired?: (kind: WeaponKind) => void;
  onEnemyHit?: (boss: boolean) => void;
  onEnemyDeath?: () => void;
  onPickup?: (kind: PickupKind) => void;
  onLevelUp?: (choices: readonly UpgradeChoice[]) => void;
  onPlayerHurt?: () => void;
  onBossSpawn?: (name: string) => void;
  onSurge?: (label: string) => void;
  onStarfall?: () => void;
  onGameOver?: () => void;
  onVictory?: () => void;
}

const ENEMY_CAP = 2000;
const PROJECTILE_CAP = 600;
const PICKUP_CAP = 900;
const HASH_CELL = 48;
const CONTACT_KNOCKBACK = 170;
const STARFALL_RADIUS = 720;
const BOSS_MINION_INTERVAL = 7;

let projectileUid = 1;

/**
 * The whole simulation: a state machine over pooled entities. No DOM, no
 * canvas — main.ts injects input frames and subscribes to events, so this
 * module (and everything it imports) runs headless under Vitest.
 */
export class Game implements CombatWorld {
  phase: Phase = 'title';
  time = 0;
  seed = 0;
  daily = false;

  player: PlayerState = createPlayer();
  rng = new Rng(1);
  readonly enemies = new Pool<Enemy>(createEnemy, 256, ENEMY_CAP);
  readonly projectiles = new Pool<Projectile>(createProjectile, 128, PROJECTILE_CAP);
  readonly pickups = new Pool<Pickup>(createPickup, 256, PICKUP_CAP);
  readonly particles = new ParticleSystem(4096);
  readonly damageNumbers = new DamageNumbers();
  readonly effects = new Effects();
  readonly hash = new SpatialHash(HASH_CELL, 2048);

  weapons: WeaponState[] = [];
  pendingChoices: readonly UpgradeChoice[] | null = null;

  /** Camera shake magnitude (px), decays; read by the renderer. */
  shake = 0;
  /** Hit-stop time remaining (real seconds). */
  hitStop = 0;
  /** Live boss reference for the HUD HP bar, or null. */
  activeBoss: Enemy | null = null;
  bossName = '';
  /** Label + countdown for HUD surge announcements (read by ui). */

  events: GameEvents = {};

  /** Viewport size in CSS px (set by main on resize); drives the spawn ring. */
  viewW = 1280;
  viewH = 720;

  readonly queryBuf: number[] = [];
  /** Hoisted once so the per-enemy separation pass allocates no closures. */
  private readonly enemyLookup = (id: number): Enemy => this.enemies.at(id);
  private readonly contactBuf: number[] = [];
  private readonly arcVisited: number[] = [];
  private spawnTimer = 0;
  private surgeIndex = 0;
  private bossIndex = 0;
  private levelUpQueue = 0;
  private frameParity = 0;

  startRun(seed: number, daily: boolean): void {
    this.seed = seed;
    this.daily = daily;
    this.rng = new Rng(seed);
    this.player = createPlayer();
    this.enemies.releaseAll();
    this.projectiles.releaseAll();
    this.pickups.releaseAll();
    this.particles.clear();
    this.damageNumbers.clear();
    this.effects.clear();
    this.hash.clear();
    this.weapons = [{ kind: 'ember', level: 1, timer: 0.3, angle: 0 }];
    this.pendingChoices = null;
    this.time = 0;
    this.shake = 0;
    this.hitStop = 0;
    this.activeBoss = null;
    this.bossName = '';
    this.spawnTimer = 1.2;
    this.surgeIndex = 0;
    this.bossIndex = 0;
    this.levelUpQueue = 0;
    this.frameParity = 0;
    this.phase = 'running';
  }

  update(dt: number, input: InputFrame): void {
    if (this.phase !== 'running' && this.phase !== 'levelup') return;

    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }

    this.time += dt;
    this.frameParity ^= 1;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 30 * dt);

    this.updatePlayer(dt, input);
    this.spawnWave(dt);
    this.rebuildHash();
    this.updateWeapons(dt);
    this.updateProjectiles(dt);
    this.updateEnemies(dt);
    this.updatePickups(dt);
    this.particles.update(dt);
    this.damageNumbers.update(dt);
    this.effects.update(dt);
    this.sweepDeaths();

    if (this.player.hp <= 0 && this.phase === 'running') {
      this.phase = 'gameover';
      this.events.onGameOver?.();
      return;
    }
    if (this.time >= RUN_DURATION && this.phase === 'running') {
      this.triggerVictory();
      return;
    }
    if (this.levelUpQueue > 0 && this.phase === 'running') {
      this.levelUpQueue--;
      this.enterLevelUp();
    }
  }

  // ---- CombatWorld implementation -------------------------------------

  enemyAt(id: number): Enemy {
    return this.enemies.at(id);
  }

  fireBolt(
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    pierce: number,
    range: number,
  ): void {
    const p = this.projectiles.tryAcquire();
    if (p === null) return;
    p.kind = 'bolt';
    p.uid = projectileUid++;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.radius = 5;
    p.damage = damage;
    p.pierce = pierce;
    p.speed = speed;
    p.turnRate = 0;
    p.life = range / speed + 0.35;
  }

  fireWisp(x: number, y: number, angle: number, speed: number, damage: number, pierce: number): void {
    const p = this.projectiles.tryAcquire();
    if (p === null) return;
    p.kind = 'wisp';
    p.uid = projectileUid++;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.radius = 6;
    p.damage = damage;
    p.pierce = pierce;
    p.speed = speed;
    p.turnRate = WISP_TURN_RATE;
    p.life = 4;
  }

  damageEnemy(e: Enemy, amount: number, kbX: number, kbY: number): void {
    e.hp -= amount;
    e.hitFlash = 1;
    e.kbX += kbX;
    e.kbY += kbY;
    this.player.damageDealt += amount;
    this.damageNumbers.spawn(e.x, e.y - e.radius, amount);
    this.events.onEnemyHit?.(e.boss !== 0);
    if (e.boss !== 0) {
      // Hit-stop + shake make boss hits land heavy.
      this.hitStop = 0.07;
      this.shake = Math.min(10, this.shake + 2.5);
    }
  }

  novaBurst(x: number, y: number, radius: number, damage: number): void {
    this.effects.spawnWave(x, y, radius, 0);
    this.hash.queryCircle(x, y, radius, this.queryBuf);
    for (let i = 0; i < this.queryBuf.length; i++) {
      const e = this.enemyAt(this.queryBuf[i] as number);
      const dist = Math.hypot(e.x - x, e.y - y) || 1;
      this.damageEnemy(e, damage, ((e.x - x) / dist) * 240, ((e.y - y) / dist) * 240);
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.particles.spawn(x, y, Math.cos(a) * 260, Math.sin(a) * 260, 0.45, 3.5, HUE.gold, 3);
    }
  }

  arcStrike(fromX: number, fromY: number, range: number, chains: number, damage: number): void {
    const first = nearestEnemy(this, fromX, fromY, range);
    if (first < 0) return;

    const arc = this.effects.beginArc();
    const visited = this.arcVisited;
    visited.length = 0;

    let cx = fromX;
    let cy = fromY;
    if (arc !== null) {
      arc.points[0] = fromX;
      arc.points[1] = fromY;
      arc.count = 1;
    }

    let currentId = first;
    let dmg = damage;
    for (let jump = 0; jump < chains && currentId >= 0; jump++) {
      const e = this.enemyAt(currentId);
      visited.push(currentId);
      this.damageEnemy(e, dmg, 0, 0);
      dmg *= ARC_DAMAGE_FALLOFF;
      if (arc !== null && arc.count < ARC_MAX_POINTS) {
        arc.points[arc.count * 2] = e.x;
        arc.points[arc.count * 2 + 1] = e.y;
        arc.count++;
      }
      cx = e.x;
      cy = e.y;

      // Next link: nearest unvisited enemy around the current one.
      this.hash.queryCircle(cx, cy, ARC_JUMP_RANGE, this.queryBuf);
      let best = -1;
      let bestDistSq = Infinity;
      for (let i = 0; i < this.queryBuf.length; i++) {
        const id = this.queryBuf[i] as number;
        if (visited.includes(id)) continue; // visited.length <= 7, linear scan is fine
        const other = this.enemyAt(id);
        const dx = other.x - cx;
        const dy = other.y - cy;
        const d = dx * dx + dy * dy;
        if (d < bestDistSq) {
          bestDistSq = d;
          best = id;
        }
      }
      currentId = best;
    }
  }

  onWeaponFired(kind: WeaponKind): void {
    this.events.onWeaponFired?.(kind);
  }

  // ---- Level-up flow ----------------------------------------------------

  chooseUpgrade(index: number): void {
    if (this.phase !== 'levelup' || this.pendingChoices === null) return;
    const choice = this.pendingChoices[index];
    if (choice === undefined) return;
    this.applyChoice(choice);
    this.pendingChoices = null;
    this.effects.spawnWave(this.player.x, this.player.y, 130, 0, 0.45);
    if (this.levelUpQueue > 0) {
      this.levelUpQueue--;
      this.enterLevelUp();
    } else {
      this.phase = 'running';
    }
  }

  private enterLevelUp(): void {
    const owned = this.weapons.map((w) => ({ kind: w.kind, level: w.level }));
    const choices = rollUpgradeChoices(owned, this.player.passives, this.rng);
    this.pendingChoices = choices;
    this.phase = 'levelup';
    this.events.onLevelUp?.(choices);
  }

  private applyChoice(choice: UpgradeChoice): void {
    switch (choice.type) {
      case 'new-weapon':
        this.weapons.push({ kind: choice.weapon, level: 1, timer: 0.2, angle: 0 });
        break;
      case 'weapon-level': {
        const w = this.weapons.find((x) => x.kind === choice.weapon);
        if (w !== undefined) w.level = Math.min(choice.toLevel, 5);
        break;
      }
      case 'passive': {
        const p = this.player.passives;
        p[choice.passive] = Math.min(choice.toLevel, PASSIVE_MAX_LEVEL);
        if (choice.passive === 'maxhp') {
          this.player.maxHp += 20;
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20);
        }
        break;
      }
      case 'heal':
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.25);
        break;
    }
  }

  togglePause(): void {
    if (this.phase === 'running') this.phase = 'paused';
    else if (this.phase === 'paused') this.phase = 'running';
  }

  // ---- Internals ----------------------------------------------------------

  private updatePlayer(dt: number, input: InputFrame): void {
    const p = this.player;
    p.prevX = p.x;
    p.prevY = p.y;
    const speed = moveSpeed(p);
    const decay = Math.max(0, 1 - 7 * dt);
    p.kbX *= decay;
    p.kbY *= decay;
    p.x += input.moveX * speed * dt + p.kbX * dt;
    p.y += input.moveY * speed * dt + p.kbY * dt;
    if (p.iframes > 0) p.iframes -= dt;
    if (p.hurtPulse > 0) p.hurtPulse = Math.max(0, p.hurtPulse - 1.6 * dt);
  }

  private spawnRingDistance(): number {
    return Math.hypot(this.viewW, this.viewH) / 2 + 60;
  }

  private spawnWave(dt: number): void {
    this.spawnTimer -= dt;
    const phase = phaseAt(this.time);
    while (this.spawnTimer <= 0) {
      this.spawnTimer += phase.interval;
      for (let i = 0; i < phase.pack; i++) {
        const kind = pickEnemyKind(this.time, this.rng);
        const elite = this.rng.chance(eliteChanceAt(this.time));
        this.spawnAtRing(kind, elite);
      }
    }

    for (;;) {
      const surge = SURGES[this.surgeIndex];
      if (surge === undefined || this.time < surge.t) break;
      this.surgeIndex++;
      for (let i = 0; i < surge.count; i++) this.spawnAtRing(surge.kind, false);
      this.events.onSurge?.(surge.label);
    }

    for (;;) {
      const boss = BOSSES[this.bossIndex];
      if (boss === undefined || this.time < boss.t) break;
      this.bossIndex++;
      const e = this.spawnAtRing(boss.kind, false);
      if (e !== null) {
        this.activeBoss = e;
        this.bossName = boss.name;
        this.shake = Math.min(12, this.shake + 8);
        this.events.onBossSpawn?.(boss.name);
      }
    }
  }

  private spawnAtRing(kind: EnemyKind, elite: boolean): Enemy | null {
    const e = this.enemies.tryAcquire();
    if (e === null) return null;
    const angle = this.rng.next() * Math.PI * 2;
    const dist = this.spawnRingDistance() + this.rng.range(0, 90);
    initEnemy(
      e,
      kind,
      this.player.x + Math.cos(angle) * dist,
      this.player.y + Math.sin(angle) * dist,
      hpScaleAt(this.time),
      speedScaleAt(this.time),
      elite,
    );
    return e;
  }

  private rebuildHash(): void {
    this.hash.clear();
    for (let i = 0; i < this.enemies.liveCount; i++) {
      const e = this.enemies.at(i);
      this.hash.insert(i, e.x, e.y, e.radius);
    }
  }

  private updateWeapons(dt: number): void {
    const dmgMult = damageMultiplier(this.player);
    const cdMult = cooldownMultiplier(this.player);
    for (let i = 0; i < this.weapons.length; i++) {
      updateWeapon(this, this.weapons[i] as WeaponState, dmgMult, cdMult, dt);
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.liveCount - 1; i >= 0; i--) {
      const p = this.projectiles.at(i);
      p.life -= dt;
      if (p.life <= 0) {
        this.projectiles.release(p);
        continue;
      }

      if (p.turnRate > 0) {
        // Homing: ids from the hash are only valid within this frame, so
        // wisps re-acquire their target every step instead of storing it.
        const target = nearestEnemy(this, p.x, p.y, 320);
        if (target >= 0) {
          const e = this.enemyAt(target);
          steerToward(p, e.x, e.y, dt);
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      this.hash.queryCircle(p.x, p.y, p.radius, this.queryBuf);
      for (let j = 0; j < this.queryBuf.length && p.pierce > 0; j++) {
        const e = this.enemyAt(this.queryBuf[j] as number);
        if (e.lastHitUid === p.uid || e.hp <= 0) continue;
        e.lastHitUid = p.uid;
        const speed = Math.hypot(p.vx, p.vy) || 1;
        this.damageEnemy(e, p.damage, (p.vx / speed) * 120, (p.vy / speed) * 120);
        this.spawnHitSparks(e.x, e.y, 3);
        p.pierce--;
      }
      if (p.pierce <= 0) this.projectiles.release(p);
    }
  }

  private updateEnemies(dt: number): void {
    const p = this.player;
    for (let i = 0; i < this.enemies.liveCount; i++) {
      const e = this.enemies.at(i);
      updateEnemySteering(e, p, dt);

      // Separation runs on alternating frames per enemy (doubled strength):
      // halves hash queries with no visible difference in packing.
      if (((i + this.frameParity) & 1) === 0) {
        applySeparation(e, this.hash, this.enemyLookup, this.contactBuf, 2, dt);
      }

      // Bosses periodically vent a ring of mites.
      if (e.boss !== 0) {
        e.emitTimer += dt;
        if (e.emitTimer >= BOSS_MINION_INTERVAL) {
          e.emitTimer = 0;
          const count = e.boss === 1 ? 8 : 12;
          for (let k = 0; k < count; k++) {
            const m = this.enemies.tryAcquire();
            if (m === null) break;
            const a = (k / count) * Math.PI * 2;
            initEnemy(
              m,
              'mite',
              e.x + Math.cos(a) * (e.radius + 14),
              e.y + Math.sin(a) * (e.radius + 14),
              hpScaleAt(this.time),
              speedScaleAt(this.time),
              false,
            );
          }
        }
      }

      // Enemies that fall too far behind are repositioned to the spawn ring
      // instead of despawning — pressure stays constant, memory stays flat.
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const farLimit = this.spawnRingDistance() * 2.2;
      if (e.boss === 0 && dx * dx + dy * dy > farLimit * farLimit) {
        const angle = this.rng.next() * Math.PI * 2;
        const dist = this.spawnRingDistance() + 40;
        e.x = p.x + Math.cos(angle) * dist;
        e.y = p.y + Math.sin(angle) * dist;
      }
    }

    // Player contact: one hash query around the player, not 1,500 checks.
    if (p.iframes <= 0) {
      this.hash.queryCircle(p.x, p.y, p.radius, this.contactBuf);
      let worst: Enemy | null = null;
      for (let i = 0; i < this.contactBuf.length; i++) {
        const e = this.enemyAt(this.contactBuf[i] as number);
        if (e.hp <= 0) continue;
        if (worst === null || e.damage > worst.damage) worst = e;
      }
      if (worst !== null) {
        p.hp -= worst.damage;
        p.iframes = IFRAME_DURATION;
        p.hurtPulse = 1;
        const dist = Math.hypot(p.x - worst.x, p.y - worst.y) || 1;
        p.kbX = ((p.x - worst.x) / dist) * CONTACT_KNOCKBACK;
        p.kbY = ((p.y - worst.y) / dist) * CONTACT_KNOCKBACK;
        this.shake = Math.min(14, this.shake + 6);
        this.events.onPlayerHurt?.();
      }
    }
  }

  private updatePickups(dt: number): void {
    const p = this.player;
    const magnetR = magnetRadius(p);
    for (let i = this.pickups.liveCount - 1; i >= 0; i--) {
      const g = this.pickups.at(i);
      g.bob += dt;
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const distSq = dx * dx + dy * dy;

      if (!g.magnetized && distSq < magnetR * magnetR) g.magnetized = true;
      if (g.magnetized) {
        const dist = Math.sqrt(distSq) || 1;
        g.pullSpeed = Math.min(900, g.pullSpeed + 1500 * dt);
        g.x += (dx / dist) * g.pullSpeed * dt;
        g.y += (dy / dist) * g.pullSpeed * dt;
        if ((g.bob * 8) % 1 < 0.5) {
          this.particles.spawn(g.x, g.y, -dx * 0.3, -dy * 0.3, 0.25, 1.6, HUE.gold, 4);
        }
      }

      if (distSq < (p.radius + 13) * (p.radius + 13)) {
        this.collectPickup(g);
        this.pickups.release(g);
      }
    }
  }

  private collectPickup(g: Pickup): void {
    const p = this.player;
    this.events.onPickup?.(g.kind);
    switch (g.kind) {
      case 'gem1':
      case 'gem2':
      case 'gem3':
        this.levelUpQueue += grantXp(p, g.value);
        break;
      case 'ember':
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.2);
        break;
      case 'magnet':
        for (let i = 0; i < this.pickups.liveCount; i++) {
          const other = this.pickups.at(i);
          if (other.kind === 'gem1' || other.kind === 'gem2' || other.kind === 'gem3') {
            other.magnetized = true;
          }
        }
        this.effects.spawnWave(p.x, p.y, 260, 0, 0.5);
        break;
      case 'starfall': {
        this.events.onStarfall?.();
        this.effects.spawnWave(p.x, p.y, STARFALL_RADIUS, 1, 0.6);
        this.shake = Math.min(14, this.shake + 8);
        for (let i = 0; i < this.enemies.liveCount; i++) {
          const e = this.enemies.at(i);
          if (e.boss !== 0 || e.elite) continue;
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          if (dx * dx + dy * dy <= STARFALL_RADIUS * STARFALL_RADIUS) e.hp = 0;
        }
        for (let i = 0; i < 140; i++) {
          const a = this.rng.next() * Math.PI * 2;
          const speed = this.rng.range(120, 520);
          this.particles.spawn(
            p.x,
            p.y,
            Math.cos(a) * speed,
            Math.sin(a) * speed,
            this.rng.range(0.4, 0.9),
            this.rng.range(2, 4.5),
            HUE.gold,
            2.5,
          );
        }
        break;
      }
      case 'prism':
        this.levelUpQueue++;
        break;
    }
  }

  private sweepDeaths(): void {
    for (let i = this.enemies.liveCount - 1; i >= 0; i--) {
      const e = this.enemies.at(i);
      if (e.hp > 0) continue;

      this.player.kills++;
      this.events.onEnemyDeath?.();
      this.spawnDeathBurst(e);
      this.dropLoot(e);

      if (e.boss !== 0) {
        this.activeBoss = null;
        this.shake = Math.min(16, this.shake + 10);
        if (e.boss === 2) {
          this.enemies.release(e);
          this.triggerVictory();
          return;
        }
      } else if (e.kind === 'splitter') {
        for (let k = 0; k < 2; k++) {
          const m = this.enemies.tryAcquire();
          if (m === null) break;
          initEnemy(
            m,
            'mite',
            e.x + this.rng.range(-8, 8),
            e.y + this.rng.range(-8, 8),
            hpScaleAt(this.time),
            speedScaleAt(this.time),
            false,
          );
        }
      }

      this.enemies.release(e);
    }
  }

  private dropLoot(e: Enemy): void {
    if (e.elite) {
      this.spawnPickup('prism', e.x, e.y, 0);
      return;
    }
    if (e.boss !== 0) {
      for (let i = 0; i < 5; i++) {
        this.spawnPickup('gem3', e.x + this.rng.range(-30, 30), e.y + this.rng.range(-30, 30), GEM_VALUES.gem3);
      }
      this.spawnPickup('ember', e.x, e.y, 0);
      return;
    }

    // Mites only sometimes drop XP, otherwise late-game gem counts explode.
    if (e.kind === 'mite' && !this.rng.chance(0.6)) return;
    const roll = this.rng.next();
    if (roll < 0.008) this.spawnPickup('ember', e.x, e.y, 0);
    else if (roll < 0.011) this.spawnPickup('magnet', e.x, e.y, 0);
    else if (roll < 0.0125) this.spawnPickup('starfall', e.x, e.y, 0);
    else this.spawnPickup(gemTierFor(e.xp), e.x, e.y, e.xp);
  }

  private spawnPickup(kind: PickupKind, x: number, y: number, value: number): void {
    const g = this.pickups.tryAcquire();
    if (g === null) {
      // Pool saturated: fold the XP into a random live gem instead of losing it.
      if (value > 0 && this.pickups.liveCount > 0) {
        const other = this.pickups.at(this.rng.int(0, this.pickups.liveCount - 1));
        other.value += value;
      }
      return;
    }
    g.kind = kind;
    g.x = x;
    g.y = y;
    g.value = value;
    g.magnetized = false;
    g.pullSpeed = 0;
    g.bob = this.rng.next() * Math.PI * 2;
  }

  private spawnDeathBurst(e: Enemy): void {
    const count = e.boss !== 0 ? 60 : e.elite ? 24 : 6;
    const hue = e.boss !== 0 || e.elite ? HUE.violet : e.kind === 'mite' || e.kind === 'darter' ? HUE.teal : HUE.violet;
    for (let i = 0; i < count; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const speed = this.rng.range(40, e.boss !== 0 ? 380 : 190);
      this.particles.spawn(
        e.x,
        e.y,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        this.rng.range(0.25, 0.6),
        this.rng.range(1.5, 3.2),
        hue,
        3,
      );
    }
  }

  private spawnHitSparks(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const speed = this.rng.range(60, 200);
      this.particles.spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed, 0.2, 1.8, HUE.gold, 4);
    }
  }

  private triggerVictory(): void {
    this.phase = 'victory';
    this.events.onVictory?.();
  }
}
