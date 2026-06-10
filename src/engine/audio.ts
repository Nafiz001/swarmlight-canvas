const MUTE_KEY = 'swarmlight.v1.muted';
const MASTER_GAIN = 0.7;

type OscType = OscillatorType;

/**
 * All sound is synthesized at runtime with the Web Audio API. The context is
 * created lazily on the first user gesture (autoplay policy), routed through
 * a master gain and a compressor acting as a soft limiter. High-frequency
 * SFX (shots, hits, pickups) are throttled so a 1,500-enemy frame cannot
 * stack hundreds of oscillators.
 */
export class AudioSystem {
  muted: boolean;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly lastPlayed = new Map<string, number>();

  constructor() {
    let stored = false;
    try {
      stored = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage unavailable; default to unmuted */
    }
    this.muted = stored;
  }

  /** Call from the first pointerdown/keydown; safe to call repeatedly. */
  unlock(): void {
    if (this.ctx === null) {
      this.ctx = new AudioContext();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 8;
      compressor.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(compressor);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master !== null && this.ctx !== null) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.02);
    }
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* best effort */
    }
    return this.muted;
  }

  shoot(): void {
    if (!this.throttle('shoot', 0.05)) return;
    this.tone(720, 1180, 0.06, 'triangle', 0.05);
  }

  hit(): void {
    if (!this.throttle('hit', 0.04)) return;
    this.tone(260, 140, 0.05, 'square', 0.035);
  }

  enemyDeath(): void {
    if (!this.throttle('death', 0.06)) return;
    this.tone(300, 70, 0.16, 'sawtooth', 0.05);
    this.noise(0.08, 0.04, 1800);
  }

  pickup(): void {
    if (!this.throttle('pickup', 0.05)) return;
    this.tone(880, 1500, 0.07, 'sine', 0.06);
  }

  levelUp(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i++) {
      this.tone(notes[i] as number, (notes[i] as number) * 1.01, 0.16, 'triangle', 0.09, i * 0.07);
    }
  }

  playerHurt(): void {
    if (!this.throttle('hurt', 0.2)) return;
    this.tone(190, 55, 0.24, 'sawtooth', 0.12);
    this.noise(0.12, 0.07, 700);
  }

  bossRoar(): void {
    this.tone(72, 38, 0.9, 'sawtooth', 0.16);
    this.tone(110, 50, 0.7, 'square', 0.08, 0.05);
    this.noise(0.7, 0.08, 320);
  }

  starfall(): void {
    this.tone(1400, 200, 0.5, 'sawtooth', 0.1);
    this.noise(0.45, 0.1, 2600);
  }

  victory(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (let i = 0; i < notes.length; i++) {
      this.tone(notes[i] as number, notes[i] as number, 0.3, 'triangle', 0.1, i * 0.13);
    }
  }

  defeat(): void {
    const notes = [392, 311.13, 261.63, 196];
    for (let i = 0; i < notes.length; i++) {
      this.tone(notes[i] as number, (notes[i] as number) * 0.97, 0.4, 'sawtooth', 0.08, i * 0.18);
    }
  }

  private throttle(name: string, minInterval: number): boolean {
    if (this.ctx === null) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < minInterval) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  private tone(
    from: number,
    to: number,
    duration: number,
    type: OscType,
    volume: number,
    delay = 0,
  ): void {
    if (this.ctx === null || this.master === null) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + duration);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(duration: number, volume: number, filterFreq: number): void {
    if (this.ctx === null || this.master === null) return;
    if (this.noiseBuffer === null) {
      const len = this.ctx.sampleRate; // 1 second of white noise, generated once
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t0, Math.random() * 0.5, duration + 0.05);
  }
}
