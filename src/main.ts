import './ui/styles.css';
import { AudioSystem } from './engine/audio';
import { Input, type InputFrame } from './engine/input';
import { GameLoop } from './engine/loop';
import { hashSeed } from './engine/rng';
import { Game } from './game/game';
import { Renderer } from './render/renderer';
import { PerfHud } from './debug/perfHud';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';
import { recordRun } from './storage';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const game = new Game();
const input = new Input(canvas);
const renderer = new Renderer(canvas, game, input.joystick);
const audio = new AudioSystem();
const hud = new Hud(uiRoot);
const screens = new Screens(uiRoot);
const perfHud = new PerfHud(uiRoot);

const LEVELUP_TIMESCALE = 0.05;

function resize(): void {
  // Render-only: the sim's spawn ring is a fixed design-resolution constant,
  // so the viewport never leaks into seeded runs.
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}
window.addEventListener('resize', resize);
resize();

// Web Audio must be created after a user gesture; unlock on the first one.
const unlockAudio = (): void => audio.unlock();
window.addEventListener('pointerdown', unlockAudio, { once: false });
window.addEventListener('keydown', unlockAudio, { once: false });

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : hashSeed(raw);
}

function startRun(daily: boolean): void {
  let seed: number;
  if (daily) {
    // Same UTC date, same run, for everyone.
    seed = hashSeed(new Date().toISOString().slice(0, 10));
  } else {
    // Free runs draw their seed outside the seeded stream.
    seed = seedFromUrl() ?? (Math.random() * 0xffffffff) >>> 0;
  }
  screens.hide();
  hud.setVisible(true);
  loop.timeScale = 1;
  game.startRun(seed, daily);
}

function showTitle(): void {
  hud.setVisible(false);
  game.phase = 'title';
  loop.timeScale = 1;
  screens.showTitle(
    () => startRun(false),
    () => startRun(true),
  );
}

function endRun(victory: boolean): void {
  // A run can end while the level-up slow-mo is active (e.g. a queued nova
  // kills the final boss under the draft overlay); never leave 0.05x behind.
  loop.timeScale = 1;
  hud.setVisible(false);
  if (victory) audio.victory();
  else audio.defeat();
  const best = recordRun(game.time, game.player.kills, game.player.level, victory);
  screens.showResult(
    {
      victory,
      time: game.time,
      level: game.player.level,
      kills: game.player.kills,
      damageDealt: game.player.damageDealt,
      seed: game.seed,
      daily: game.daily,
      best,
    },
    () => startRun(game.daily),
    () => showTitle(),
  );
}

function pause(): void {
  if (game.phase !== 'running') return;
  game.togglePause();
  screens.showPause(resume, () => {
    screens.hide();
    showTitle();
  });
}

function resume(): void {
  if (game.phase !== 'paused') return;
  screens.hide();
  game.togglePause();
}

game.events = {
  onWeaponFired: (kind) => {
    if (kind === 'ember' || kind === 'wisp') audio.shoot();
  },
  onEnemyHit: () => audio.hit(),
  onEnemyDeath: () => audio.enemyDeath(),
  onPickup: (kind) => {
    if (kind === 'starfall') return; // starfall has its own stinger
    audio.pickup();
  },
  onLevelUp: (choices) => {
    // Queued level-ups re-fire this event from chooseUpgrade, replacing the
    // overlay until the queue drains and the timescale is restored.
    audio.levelUp();
    loop.timeScale = LEVELUP_TIMESCALE;
    screens.showLevelUp(choices, (index) => {
      game.chooseUpgrade(index);
      if (game.phase !== 'levelup') loop.timeScale = 1;
    });
  },
  onPlayerHurt: () => audio.playerHurt(),
  onBossSpawn: (name) => {
    audio.bossRoar();
    hud.announce(name);
  },
  onSurge: (label) => hud.announce(label),
  onStarfall: () => audio.starfall(),
  onGameOver: () => endRun(false),
  onVictory: () => endRun(true),
};

input.onKey('Escape', () => (game.phase === 'paused' ? resume() : pause()));
input.onKey('KeyP', () => (game.phase === 'paused' ? resume() : pause()));
input.onKey('KeyM', () => audio.toggleMute());
input.onKey('F3', () => perfHud.toggle());

// A hidden tab stops rendering; pause so the player never dies off-screen.
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

const frame: InputFrame = { moveX: 0, moveY: 0 };

const loop = new GameLoop(
  (dt) => {
    game.update(dt, input.frame(frame));
  },
  (alpha, frameDt) => {
    renderer.render(alpha, frameDt);
    hud.update(game);
    perfHud.frame(loop.frameMs, frameDt, game);
  },
);

showTitle();
loop.start();
