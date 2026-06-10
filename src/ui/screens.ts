import type { UpgradeChoice } from '../game/upgrades';
import type { BestStats } from '../storage';

export interface ResultData {
  victory: boolean;
  time: number;
  level: number;
  kills: number;
  damageDealt: number;
  seed: number;
  daily: boolean;
  best: BestStats;
}

/**
 * All menus are DOM overlays: cheap to build, accessible, and they never
 * touch the canvas hot path. Only one screen exists at a time.
 */
export class Screens {
  private current: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly parent: HTMLElement) {}

  hide(): void {
    if (this.current !== null) {
      this.current.remove();
      this.current = null;
    }
    if (this.keyHandler !== null) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }

  private show(className: string, html: string): HTMLElement {
    this.hide();
    const el = document.createElement('div');
    el.className = `screen ${className}`;
    el.innerHTML = html;
    this.parent.appendChild(el);
    this.current = el;
    return el;
  }

  showTitle(onStart: () => void, onDaily: () => void): void {
    const el = this.show(
      'title',
      `
      <div class="micro">A ten minute vigil</div>
      <h1>Swarmlight</h1>
      <p class="lede">
        You are the last light. Hold back the tide of darkness until the
        hour turns. Your lantern fights on its own &mdash; you decide where
        to stand and what to become.
      </p>
      <div class="btn-row">
        <button class="btn primary" data-start>Begin the vigil</button>
        <button class="btn" data-daily>Daily run</button>
      </div>
      <div class="controls-hint">
        <span class="micro"><b>WASD / arrows</b> &nbsp;move</span>
        <span class="micro"><b>P / Esc</b> &nbsp;pause</span>
        <span class="micro"><b>M</b> &nbsp;mute</span>
        <span class="micro"><b>F3</b> &nbsp;perf</span>
      </div>
    `,
    );
    el.querySelector('[data-start]')?.addEventListener('click', onStart);
    el.querySelector('[data-daily]')?.addEventListener('click', onDaily);
  }

  showLevelUp(choices: readonly UpgradeChoice[], onPick: (index: number) => void): void {
    const cards = choices
      .map((c, i) => {
        const kicker =
          c.type === 'passive'
            ? '<span class="kicker passive">Passive</span>'
            : c.type === 'new-weapon'
              ? '<span class="kicker">New weapon</span>'
              : c.type === 'heal'
                ? '<span class="kicker passive">Respite</span>'
                : '<span class="kicker">Weapon</span>';
        return `
          <button class="card" data-pick="${i}">
            ${kicker}
            <span class="title">${c.title}</span>
            <span class="detail">${c.detail}</span>
            <span class="key">Press ${i + 1}</span>
          </button>`;
      })
      .join('');

    const el = this.show(
      'levelup translucent',
      `
      <div class="micro">The light grows</div>
      <h2>Choose</h2>
      <div class="cards">${cards}</div>
    `,
    );

    const pick = (index: number): void => {
      if (index < 0 || index >= choices.length) return;
      this.hide();
      onPick(index);
    };
    el.querySelectorAll<HTMLElement>('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => pick(Number(btn.dataset['pick'])));
    });
    this.keyHandler = (e: KeyboardEvent): void => {
      if (e.code === 'Digit1' || e.code === 'Numpad1') pick(0);
      else if (e.code === 'Digit2' || e.code === 'Numpad2') pick(1);
      else if (e.code === 'Digit3' || e.code === 'Numpad3') pick(2);
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  showPause(onResume: () => void, onQuit: () => void): void {
    const el = this.show(
      'pause translucent',
      `
      <h2>Paused</h2>
      <div class="btn-row">
        <button class="btn primary" data-resume>Resume</button>
        <button class="btn" data-quit>Abandon run</button>
      </div>
    `,
    );
    el.querySelector('[data-resume]')?.addEventListener('click', onResume);
    el.querySelector('[data-quit]')?.addEventListener('click', onQuit);
  }

  showResult(data: ResultData, onRetry: () => void, onTitle: () => void): void {
    const m = Math.floor(data.time / 60);
    const s = Math.floor(data.time % 60);
    const heading = data.victory ? 'Dawn breaks' : 'The light goes out';
    const sub = data.victory
      ? 'You held the dark at bay for the full vigil.'
      : 'The swarm closes over the last ember.';
    const el = this.show(
      'result',
      `
      <div class="micro">${data.daily ? 'Daily run' : 'Free run'}</div>
      <h2>${heading}</h2>
      <p class="lede">${sub}</p>
      <div class="stats-grid">
        <div><div class="micro">Survived</div><div class="stat-value">${m}:${s < 10 ? '0' : ''}${s}</div></div>
        <div><div class="micro">Level</div><div class="stat-value">${data.level}</div></div>
        <div><div class="micro">Extinguished</div><div class="stat-value">${data.kills}</div></div>
        <div><div class="micro">Damage dealt</div><div class="stat-value">${Math.round(data.damageDealt)}</div></div>
      </div>
      <div class="seed-line">seed ${data.seed} &mdash; share with ?seed=${data.seed}</div>
      <div class="seed-line">
        best: ${Math.floor(data.best.bestTime / 60)}:${String(Math.floor(data.best.bestTime % 60)).padStart(2, '0')}
        &middot; ${data.best.bestKills} kills &middot; level ${data.best.bestLevel}
        &middot; ${data.best.victories}/${data.best.runs} dawns
      </div>
      <div class="btn-row">
        <button class="btn primary" data-retry>Run again</button>
        <button class="btn" data-title>Title</button>
      </div>
    `,
    );
    el.querySelector('[data-retry]')?.addEventListener('click', onRetry);
    el.querySelector('[data-title]')?.addEventListener('click', onTitle);
  }
}
