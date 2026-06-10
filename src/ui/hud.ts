import type { Game } from '../game/game';
import { xpForLevel } from '../game/player';
import { RUN_DURATION } from '../game/waves';

/**
 * In-game HUD. DOM writes are gated behind value-change checks so a 60 fps
 * render loop touches the DOM only when a number actually changes.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly levelEl: HTMLElement;
  private readonly killsEl: HTMLElement;
  private readonly bossWrap: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly announceEl: HTMLElement;

  private lastSecond = -1;
  private lastHp = -1;
  private lastXpRatio = -1;
  private lastLevel = -1;
  private lastKills = -1;
  private lastBossRatio = -1;
  private announceTimer: number | undefined;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top-left">
        <div>
          <div class="micro">Lantern</div>
          <div class="bar"><div class="bar-fill hp"></div></div>
        </div>
        <div>
          <div class="micro">Level</div>
          <div class="stat-value" data-level>1</div>
        </div>
      </div>
      <div class="hud-timer">
        <div class="micro">Time in the dark</div>
        <div class="time" data-time>0:00</div>
      </div>
      <div class="hud-top-right">
        <div>
          <div class="micro">Extinguished</div>
          <div class="stat-value" data-kills>0</div>
        </div>
      </div>
      <div class="hud-boss">
        <div class="micro" data-boss-name></div>
        <div class="bar"><div class="bar-fill boss"></div></div>
      </div>
      <div class="hud-announce" data-announce></div>
      <div class="hud-xp"><div class="bar-fill" style="transform: scaleX(0)"></div></div>
    `;
    parent.appendChild(this.root);

    this.timeEl = this.query('[data-time]');
    this.hpFill = this.query('.bar-fill.hp');
    this.xpFill = this.query('.hud-xp .bar-fill');
    this.levelEl = this.query('[data-level]');
    this.killsEl = this.query('[data-kills]');
    this.bossWrap = this.query('.hud-boss');
    this.bossName = this.query('[data-boss-name]');
    this.bossFill = this.query('.bar-fill.boss');
    this.announceEl = this.query('[data-announce]');
  }

  private query(selector: string): HTMLElement {
    const el = this.root.querySelector<HTMLElement>(selector);
    if (el === null) throw new Error(`HUD element missing: ${selector}`);
    return el;
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('visible', visible);
  }

  announce(text: string): void {
    this.announceEl.textContent = text;
    this.announceEl.classList.add('visible');
    window.clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => {
      this.announceEl.classList.remove('visible');
    }, 2600);
  }

  update(game: Game): void {
    const p = game.player;

    const second = Math.min(RUN_DURATION, Math.floor(game.time));
    if (second !== this.lastSecond) {
      this.lastSecond = second;
      const m = Math.floor(second / 60);
      const s = second % 60;
      this.timeEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    const hp = Math.max(0, Math.ceil(p.hp));
    if (hp !== this.lastHp) {
      this.lastHp = hp;
      this.hpFill.style.transform = `scaleX(${Math.max(0, p.hp / p.maxHp)})`;
    }

    const xpRatio = Math.round((p.xp / xpForLevel(p.level)) * 200) / 200;
    if (xpRatio !== this.lastXpRatio) {
      this.lastXpRatio = xpRatio;
      this.xpFill.style.transform = `scaleX(${Math.min(1, xpRatio)})`;
    }

    if (p.level !== this.lastLevel) {
      this.lastLevel = p.level;
      this.levelEl.textContent = String(p.level);
    }

    if (p.kills !== this.lastKills) {
      this.lastKills = p.kills;
      this.killsEl.textContent = String(p.kills);
    }

    const boss = game.activeBoss;
    if (boss !== null) {
      this.bossWrap.classList.add('visible');
      if (this.bossName.textContent !== game.bossName) this.bossName.textContent = game.bossName;
      const ratio = Math.round((boss.hp / boss.maxHp) * 200) / 200;
      if (ratio !== this.lastBossRatio) {
        this.lastBossRatio = ratio;
        this.bossFill.style.transform = `scaleX(${Math.max(0, ratio)})`;
      }
    } else {
      this.bossWrap.classList.remove('visible');
      this.lastBossRatio = -1;
    }
  }
}
